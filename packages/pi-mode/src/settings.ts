import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const SHOW_MODE_NAME_SETTINGS_KEY = "modeShowName";

const SETTINGS_LOCK_TIMEOUT_MS = 5_000;
const STALE_SETTINGS_LOCK_MS = 30_000;

let cachedShowModeName: boolean | undefined;
let cachedSettingsMtimeMs: number | null | undefined;

function getSettingsPath(): string {
    return join(getAgentDir(), "settings.json");
}

function getErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string") return code;
    return undefined;
}

function throwError(error: unknown): never {
    if (error instanceof Error) throw error;
    throw new Error(String(error));
}

function sleepSync(ms: number): void {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function withSettingsLock<T>(settingsPath: string, fn: () => T): T {
    const lockPath = `${settingsPath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true });

    const start = Date.now();
    while (true) {
        try {
            const fd = openSync(lockPath, "wx");
            try {
                writeFileSync(
                    fd,
                    `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
                    "utf8",
                );
            } catch {
                // Ignore best-effort lock metadata.
            }

            try {
                return fn();
            } finally {
                try {
                    closeSync(fd);
                } catch {
                    // Ignore cleanup failures.
                }
                try {
                    unlinkSync(lockPath);
                } catch {
                    // Ignore cleanup failures.
                }
            }
        } catch (error: unknown) {
            if (getErrorCode(error) !== "EEXIST") throwError(error);

            try {
                const stat = statSync(lockPath);
                if (Date.now() - stat.mtimeMs > STALE_SETTINGS_LOCK_MS) {
                    unlinkSync(lockPath);
                    continue;
                }
            } catch {
                // Ignore stale-lock checks.
            }

            if (Date.now() - start > SETTINGS_LOCK_TIMEOUT_MS) {
                throw new Error(`Timed out waiting for lock: ${lockPath}`);
            }
            sleepSync(40 + Math.random() * 80);
        }
    }
}

function atomicWriteUtf8Sync(filePath: string, content: string): void {
    mkdirSync(dirname(filePath), { recursive: true });

    const tempPath = join(
        dirname(filePath),
        `.${filePath.split(/[\\/]/).pop() ?? "settings.json"}.tmp.${process.pid}.${Math.random()
            .toString(16)
            .slice(2)}`,
    );

    writeFileSync(tempPath, content, "utf8");

    try {
        renameSync(tempPath, filePath);
    } catch (error: unknown) {
        const code = getErrorCode(error);
        if (code === "EEXIST" || code === "EPERM") {
            try {
                unlinkSync(filePath);
            } catch {
                // Ignore missing target before retrying the rename.
            }
            renameSync(tempPath, filePath);
            return;
        }
        try {
            unlinkSync(tempPath);
        } catch {
            // Ignore cleanup failures.
        }
        throwError(error);
    }
}

function getSettingsMtimeMs(): number | null {
    try {
        if (!existsSync(getSettingsPath())) return null;
        return statSync(getSettingsPath()).mtimeMs;
    } catch {
        return null;
    }
}

function readSettingsObject(options?: { throwOnInvalid?: boolean }): Record<string, unknown> {
    const settingsPath = getSettingsPath();
    try {
        const raw = readFileSync(settingsPath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return { ...parsed };
        }
        if (options?.throwOnInvalid === true) {
            throw new Error(`${settingsPath} must contain a JSON object.`);
        }
    } catch (error: unknown) {
        if (getErrorCode(error) === "ENOENT") return {};
        if (options?.throwOnInvalid === true) throwError(error);
        // Ignore malformed settings files while reading and fall back to defaults.
    }

    return {};
}

function updateSettingsObject(update: (settings: Record<string, unknown>) => void): void {
    const settingsPath = getSettingsPath();
    withSettingsLock(settingsPath, () => {
        const settings = readSettingsObject({ throwOnInvalid: true });
        update(settings);
        atomicWriteUtf8Sync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    });
}

export function shouldShowModeName(): boolean {
    const mtimeMs = getSettingsMtimeMs();
    if (cachedShowModeName !== undefined && cachedSettingsMtimeMs === mtimeMs) {
        return cachedShowModeName;
    }

    const settings = readSettingsObject();
    cachedSettingsMtimeMs = mtimeMs;
    cachedShowModeName = settings[SHOW_MODE_NAME_SETTINGS_KEY] === true;
    return cachedShowModeName;
}

export function setShowModeName(show: boolean): void {
    updateSettingsObject((settings) => {
        settings[SHOW_MODE_NAME_SETTINGS_KEY] = show;
    });

    cachedSettingsMtimeMs = getSettingsMtimeMs();
    cachedShowModeName = show;
}
