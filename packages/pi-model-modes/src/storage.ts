import {
    getPiGlobalSettingsPath,
    getPiProjectSettingsPath,
    loadPiExtensionSettings,
} from "@zigai/pi-extension-settings/pi";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";

import modelModesSettingsDefinition from "./settings.ts";

export function getGlobalAgentDir(): string {
    return getAgentDir();
}

const EXTENSION_ID = "pi-model-modes";
export function getGlobalModesPath(): string {
    return getPiGlobalSettingsPath(EXTENSION_ID);
}

export function getProjectModesPath(cwd: string): string {
    return getPiProjectSettingsPath(EXTENSION_ID, cwd);
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

export async function prepareModesConfig(cwd: string, projectTrusted: boolean): Promise<void> {
    loadPiExtensionSettings(
        modelModesSettingsDefinition,
        { cwd, isProjectTrusted: () => projectTrusted },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
}

export async function scaffoldGlobalModesConfig(): Promise<void> {
    await prepareModesConfig(process.cwd(), false);
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
