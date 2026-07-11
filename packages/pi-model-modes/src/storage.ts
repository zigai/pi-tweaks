import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";

export function getGlobalAgentDir(): string {
    return getAgentDir();
}

const EXTENSION_ID = "pi-model-modes";
const LEGACY_EXTENSION_ID = "pi-mode";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";

const DEFAULT_MODES_CONFIG_FILE = {
    $schema: `./${SCHEMA_FILE}`,
    version: 1,
    currentMode: "default",
    modeUseThinkingBorderColors: false,
    modeShowThinkingLevelStatus: false,
    modes: {},
};

function getGlobalModesPathForExtension(extensionId: string): string {
    return path.join(getGlobalAgentDir(), extensionId, CONFIG_FILE);
}

function getProjectModesPathForExtension(cwd: string, extensionId: string): string {
    return path.join(cwd, CONFIG_DIR_NAME, extensionId, CONFIG_FILE);
}

export function getGlobalModesPath(): string {
    return getGlobalModesPathForExtension(EXTENSION_ID);
}

export function getProjectModesPath(cwd: string): string {
    return getProjectModesPathForExtension(cwd, EXTENSION_ID);
}

export function getLegacyProjectModesPath(cwd: string): string {
    return getProjectModesPathForExtension(cwd, LEGACY_EXTENSION_ID);
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.stat(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function ensureDirForFile(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function getSchemaPath(configPath: string): string {
    return path.join(path.dirname(configPath), SCHEMA_FILE);
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
    try {
        await ensureDirForFile(filePath);
        await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST") return;
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

async function refreshSchemaFile(filePath: string, content: string): Promise<void> {
    let temporaryPath: string | undefined;
    try {
        await ensureDirForFile(filePath);
        try {
            if ((await fs.readFile(filePath, "utf8")) === content) return;
        } catch (error: unknown) {
            if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }

        const nextTemporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await fs.writeFile(nextTemporaryPath, content, { encoding: "utf8", flag: "wx" });
        temporaryPath = nextTemporaryPath;
        await fs.rename(temporaryPath, filePath);
        temporaryPath = undefined;
    } catch (error: unknown) {
        if (temporaryPath !== undefined) {
            try {
                await fs.unlink(temporaryPath);
            } catch {
                // Ignore cleanup failure while reporting the original scaffold failure.
            }
        }
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

async function readBundledSchema(): Promise<string | undefined> {
    try {
        return await fs.readFile(new URL("../config.schema.json", import.meta.url), "utf8");
    } catch {
        return undefined;
    }
}

async function copyLegacyGlobalConfigIfMissing(configPath: string): Promise<void> {
    if (await fileExists(configPath)) return;

    try {
        const legacyConfig = await fs.readFile(
            getGlobalModesPathForExtension(LEGACY_EXTENSION_ID),
            "utf8",
        );
        await writeIfMissing(configPath, legacyConfig);
    } catch {}
}

export async function scaffoldGlobalModesConfig(): Promise<void> {
    const globalConfigPath = getGlobalModesPath();
    const schema = await readBundledSchema();
    if (schema !== undefined) {
        await refreshSchemaFile(getSchemaPath(globalConfigPath), schema);
    }
    await copyLegacyGlobalConfigIfMissing(globalConfigPath);
    await writeIfMissing(
        globalConfigPath,
        `${JSON.stringify(DEFAULT_MODES_CONFIG_FILE, null, 2)}\n`,
    );
}

export async function getMtimeMs(filePath: string): Promise<number | null> {
    try {
        const stat = await fs.stat(filePath);
        return stat.mtimeMs;
    } catch {
        return null;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

function getLockPathForFile(filePath: string): string {
    return `${filePath}.lock`;
}

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const lockPath = getLockPathForFile(filePath);
    await ensureDirForFile(lockPath);

    const start = Date.now();
    while (true) {
        try {
            const handle = await fs.open(lockPath, "wx");
            try {
                await handle.writeFile(
                    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) +
                        "\n",
                    "utf8",
                );
            } catch {
                // ignore best-effort lock metadata
            }

            try {
                return await fn();
            } finally {
                await handle.close().catch(() => {});
                await fs.unlink(lockPath).catch(() => {});
            }
        } catch (error: unknown) {
            if (getErrorCode(error) !== "EEXIST") throwError(error);

            try {
                const stat = await fs.stat(lockPath);
                if (Date.now() - stat.mtimeMs > 30_000) {
                    await fs.unlink(lockPath);
                    continue;
                }
            } catch {
                // ignore stale-lock checks
            }

            if (Date.now() - start > 5_000) {
                throw new Error(`Timed out waiting for lock: ${lockPath}`);
            }
            await sleep(40 + Math.random() * 80);
        }
    }
}

export async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
    await ensureDirForFile(filePath);

    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tempPath = path.join(
        dir,
        `.${base}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`,
    );

    await fs.writeFile(tempPath, content, "utf8");

    try {
        await fs.rename(tempPath, filePath);
    } catch (error: unknown) {
        const code = getErrorCode(error);
        if (code === "EEXIST" || code === "EPERM") {
            await fs.unlink(filePath).catch(() => {});
            await fs.rename(tempPath, filePath);
        } else {
            await fs.unlink(tempPath).catch(() => {});
            throwError(error);
        }
    }
}
