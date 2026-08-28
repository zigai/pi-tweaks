import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getPiGlobalSettingsPath, getPiProjectSettingsPath } from "@zigai/pi-extension-settings/pi";
import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import {
    applyModesPatch,
    computeModesPatch,
    createDefaultModes,
    ensureDefaultModeEntries,
    normalizeThinkingLevel,
    parseModeColor,
    type DefaultModelSpec,
    type ModesFile,
    type ModeSpec,
} from "./modes.ts";
import {
    defaultThinkingLevelSchema,
    loadModelModesSettings,
    modeThinkingLevelSchema,
    type LoadedModelModesSettings,
} from "./settings.ts";

const ModeSpecJsonSchema = Type.Object(
    {
        provider: Type.Optional(Type.String()),
        modelId: Type.Optional(Type.String()),
        thinkingLevel: Type.Optional(modeThinkingLevelSchema),
        color: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);
const DefaultModelJsonSchema = Type.Object(
    {
        provider: Type.String({ minLength: 1 }),
        modelId: Type.String({ minLength: 1 }),
        thinkingLevel: Type.Optional(defaultThinkingLevelSchema),
    },
    { additionalProperties: false },
);

const ModesFileJsonSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        version: Type.Optional(Type.Number()),
        currentMode: Type.Optional(Type.String()),
        defaultModel: Type.Optional(DefaultModelJsonSchema),
        modeUseThinkingBorderColors: Type.Optional(Type.Boolean()),
        modeShowThinkingLevelStatus: Type.Optional(Type.Boolean()),
        shortcuts: Type.Optional(
            Type.Object(
                {
                    forward: Type.Optional(Type.String({ minLength: 1 })),
                    backward: Type.Optional(Type.String({ minLength: 1 })),
                },
                { additionalProperties: false },
            ),
        ),
        modes: Type.Optional(Type.Record(Type.String(), ModeSpecJsonSchema)),
    },
    { additionalProperties: false },
);

type ModeSpecJson = Static<typeof ModeSpecJsonSchema>;
type DefaultModelJson = Static<typeof DefaultModelJsonSchema>;
type ModesFileJson = Static<typeof ModesFileJsonSchema>;

type NodeErrorWithCode = Error & {
    readonly code: string;
};

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

const modesFileJsonDecoder = {
    parse(value: unknown, label = "pi-model-modes config.json"): ModesFileJson {
        const errors = [...Value.Errors(ModesFileJsonSchema, value)];
        if (errors.length > 0) {
            const messages = errors
                .slice(0, 5)
                .map((error) => `${formatSchemaPath(error.instancePath)} ${error.message}`);
            let suffix = "";
            if (errors.length > messages.length) {
                suffix = `; and ${errors.length - messages.length} more`;
            }
            throw new Error(`${label} is invalid: ${messages.join("; ")}${suffix}`);
        }
        return Value.Parse(ModesFileJsonSchema, value);
    },
};

function isNodeErrorWithCode(cause: unknown): cause is NodeErrorWithCode {
    return cause instanceof Error && "code" in cause && typeof cause.code === "string";
}

function getErrorCode(cause: unknown): string | undefined {
    if (isNodeErrorWithCode(cause)) return cause.code;
    return undefined;
}

function errorMessage(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    return String(cause);
}

function throwLoadError(filePath: string, cause: unknown): never {
    throw new Error(`Failed to load ${filePath}: ${errorMessage(cause)}`);
}

function sanitizeModeSpec(spec: ModeSpecJson | undefined): ModeSpec {
    if (spec === undefined) return {};

    const sanitized: ModeSpec = {};
    const thinkingLevel = normalizeThinkingLevel(spec.thinkingLevel);
    if (thinkingLevel !== undefined) sanitized.thinkingLevel = thinkingLevel;
    if (spec.provider !== undefined) sanitized.provider = spec.provider;
    if (spec.modelId !== undefined) sanitized.modelId = spec.modelId;
    if (spec.color !== undefined) sanitized.color = parseModeColor(spec.color);
    return sanitized;
}

function sanitizeDefaultModelSpec(
    spec: DefaultModelJson | undefined,
): DefaultModelSpec | undefined {
    if (spec === undefined) return undefined;

    const sanitized: DefaultModelSpec = {
        provider: spec.provider,
        modelId: spec.modelId,
    };
    const thinkingLevel = normalizeThinkingLevel(spec.thinkingLevel);
    if (thinkingLevel !== undefined) sanitized.thinkingLevel = thinkingLevel;
    return sanitized;
}

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
    loadModelModesSettings({ cwd, projectTrusted });
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

function throwError(cause: unknown): never {
    if (cause instanceof Error) throw cause;
    throw new Error(String(cause));
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

async function readConfigObject(filePath: string): Promise<ModesFileJson> {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        return modesFileJsonDecoder.parse(parsedJson, filePath);
    } catch (cause: unknown) {
        if (getErrorCode(cause) === "ENOENT") return {};
        throwLoadError(filePath, cause);
    }
}

export type ModesStoreContext = {
    readonly cwd: string;
    readonly projectTrusted: boolean;
};

type LoadModelModesSettings = (
    context: ModesStoreContext,
) => Pick<LoadedModelModesSettings, "globalConfigPath" | "projectConfigPath">;

export type SavedModes = {
    readonly data: ModesFile;
    readonly mtimeMs: number | null;
};

export class ModesStore {
    constructor(private readonly loadSettings: LoadModelModesSettings = loadModelModesSettings) {}

    async resolvePath(context: ModesStoreContext): Promise<string> {
        const loaded = this.loadSettings(context);
        if (
            context.projectTrusted &&
            loaded.projectConfigPath !== undefined &&
            (await fileExists(loaded.projectConfigPath))
        ) {
            return loaded.projectConfigPath;
        }
        return loaded.globalConfigPath;
    }

    async load(
        filePath: string,
        fallbackMode: ModeSpec,
        options?: { readonly throwOnInvalid?: boolean },
    ): Promise<ModesFile> {
        try {
            const raw = await fs.readFile(filePath, "utf8");
            const parsedJson: unknown = JSON.parse(raw);
            const parsed = modesFileJsonDecoder.parse(parsedJson);
            const modes: Record<string, ModeSpec> = {};
            for (const [key, value] of Object.entries(parsed.modes ?? {})) {
                modes[key] = sanitizeModeSpec(value);
            }
            const file: ModesFile = {
                version: 1,
                currentMode: parsed.currentMode ?? "default",
                modes,
            };
            const defaultModel = sanitizeDefaultModelSpec(parsed.defaultModel);
            if (defaultModel !== undefined) file.defaultModel = defaultModel;
            ensureDefaultModeEntries(file, fallbackMode);
            return file;
        } catch (cause: unknown) {
            if (getErrorCode(cause) === "ENOENT") return createDefaultModes(fallbackMode);
            if (options?.throwOnInvalid === true) throwLoadError(filePath, cause);
            return createDefaultModes(fallbackMode);
        }
    }

    async saveChanges(
        filePath: string,
        baseline: ModesFile,
        next: ModesFile,
        fallbackMode: ModeSpec,
    ): Promise<SavedModes | null> {
        const patch = computeModesPatch(baseline, next, false);
        if (patch === null) return null;

        return withFileLock(filePath, async () => {
            const latest = await this.load(filePath, fallbackMode, { throwOnInvalid: true });
            applyModesPatch(latest, patch);
            ensureDefaultModeEntries(latest, fallbackMode);
            await this.save(filePath, latest);
            return { data: latest, mtimeMs: await getMtimeMs(filePath) };
        });
    }

    private async save(filePath: string, data: ModesFile): Promise<void> {
        const config = await readConfigObject(filePath);
        config.version = data.version;
        config.currentMode = data.currentMode;
        if (data.defaultModel === undefined) delete config.defaultModel;
        else config.defaultModel = data.defaultModel;
        config.modes = data.modes;
        await atomicWriteUtf8(filePath, `${JSON.stringify(config, null, 2)}\n`);
    }
}
