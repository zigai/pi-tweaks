import {
    getAgentDir,
    SettingsManager,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
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
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const SHOW_MODE_NAME_SETTINGS_KEY = "modeShowName";
export const USE_THINKING_BORDER_COLORS_SETTINGS_KEY = "modeUseThinkingBorderColors";

const SETTINGS_LOCK_TIMEOUT_MS = 5_000;
const STALE_SETTINGS_LOCK_MS = 30_000;
const SettingsObjectSchema = Type.Object({});
const BooleanSettingSchema = Type.Boolean();

type SettingsReadContext = {
    cwd: string;
    projectTrusted: boolean;
};

let settingsReadContext: SettingsReadContext | undefined;
let cachedSettings:
    | {
          mtimeKey: string;
          showModeName: boolean;
          useThinkingBorderColors: boolean;
      }
    | undefined;

type ProjectTrustContext = ExtensionContext & {
    isProjectTrusted?: () => boolean;
};

function isProjectTrusted(ctx: ExtensionContext): boolean {
    return (ctx as ProjectTrustContext).isProjectTrusted?.() ?? true;
}

export function setSettingsContext(ctx: ExtensionContext): void {
    const next: SettingsReadContext = {
        cwd: ctx.cwd,
        projectTrusted: isProjectTrusted(ctx),
    };
    if (
        settingsReadContext?.cwd !== next.cwd ||
        settingsReadContext.projectTrusted !== next.projectTrusted
    ) {
        settingsReadContext = next;
        cachedSettings = undefined;
    }
}

function getSettingsPath(): string {
    return join(getAgentDir(), "settings.json");
}

function getProjectSettingsPath(): string | undefined {
    if (settingsReadContext === undefined || !settingsReadContext.projectTrusted) {
        return undefined;
    }
    return join(settingsReadContext.cwd, ".pi", "settings.json");
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

function parseOptionalBoolean(schema: TSchema, value: unknown): boolean | undefined {
    if (value === undefined) return undefined;
    if (!Value.Check(schema, value)) return undefined;
    const parsed: unknown = Value.Parse(schema, value);
    if (typeof parsed === "boolean") return parsed;
    return undefined;
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

function getFileMtimeMs(filePath: string | undefined): number | null {
    if (filePath === undefined) return null;
    try {
        if (!existsSync(filePath)) return null;
        return statSync(filePath).mtimeMs;
    } catch {
        return null;
    }
}

function getSettingsMtimeKey(): string {
    return `${getFileMtimeMs(getSettingsPath())}:${getFileMtimeMs(getProjectSettingsPath())}`;
}

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

function parseSettingsObject(value: unknown, settingsPath: string): Record<string, unknown> {
    const errors = [...Value.Errors(SettingsObjectSchema, value)];
    if (errors.length > 0) {
        const messages = errors
            .slice(0, 5)
            .map((error) => `${formatSchemaPath(error.instancePath)} ${error.message}`);
        let suffix = "";
        if (errors.length > messages.length) {
            suffix = `; and ${errors.length - messages.length} more`;
        }
        throw new Error(
            `${settingsPath} must contain a JSON object: ${messages.join("; ")}${suffix}`,
        );
    }
    return { ...(Value.Parse(SettingsObjectSchema, value) as Record<string, unknown>) };
}

function readSettingsObject(options?: { throwOnInvalid?: boolean }): Record<string, unknown> {
    const settingsPath = getSettingsPath();
    try {
        const raw = readFileSync(settingsPath, "utf8");
        return parseSettingsObject(JSON.parse(raw), settingsPath);
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

function applyBooleanSetting(
    settings: Record<string, unknown>,
    key: string,
    fallback: boolean,
): boolean {
    const parsed = parseOptionalBoolean(BooleanSettingSchema, settings[key]);
    if (parsed === undefined) return fallback;
    return parsed;
}

function readModeSettings(): {
    showModeName: boolean;
    useThinkingBorderColors: boolean;
} {
    const mtimeKey = getSettingsMtimeKey();
    if (cachedSettings?.mtimeKey === mtimeKey) {
        return cachedSettings;
    }

    const context = settingsReadContext ?? { cwd: process.cwd(), projectTrusted: false };
    const manager = SettingsManager.create(context.cwd, getAgentDir(), {
        projectTrusted: context.projectTrusted,
    });
    let showModeName = false;
    let useThinkingBorderColors = false;

    const globalSettings = manager.getGlobalSettings() as Record<string, unknown>;
    showModeName = applyBooleanSetting(globalSettings, SHOW_MODE_NAME_SETTINGS_KEY, showModeName);
    useThinkingBorderColors = applyBooleanSetting(
        globalSettings,
        USE_THINKING_BORDER_COLORS_SETTINGS_KEY,
        useThinkingBorderColors,
    );

    const projectSettings = manager.getProjectSettings() as Record<string, unknown>;
    showModeName = applyBooleanSetting(projectSettings, SHOW_MODE_NAME_SETTINGS_KEY, showModeName);
    useThinkingBorderColors = applyBooleanSetting(
        projectSettings,
        USE_THINKING_BORDER_COLORS_SETTINGS_KEY,
        useThinkingBorderColors,
    );

    cachedSettings = {
        mtimeKey,
        showModeName,
        useThinkingBorderColors,
    };
    return cachedSettings;
}

export function shouldShowModeName(): boolean {
    return readModeSettings().showModeName;
}

export function shouldUseThinkingBorderColors(): boolean {
    return readModeSettings().useThinkingBorderColors;
}

export function setShowModeName(show: boolean): void {
    updateSettingsObject((settings) => {
        settings[SHOW_MODE_NAME_SETTINGS_KEY] = show;
    });

    cachedSettings = undefined;
}

export function setUseThinkingBorderColors(useThinkingBorderColors: boolean): void {
    updateSettingsObject((settings) => {
        settings[USE_THINKING_BORDER_COLORS_SETTINGS_KEY] = useThinkingBorderColors;
    });

    cachedSettings = undefined;
}
