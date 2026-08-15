import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
    getPiGlobalSettingsPath,
    getPiProjectSettingsPath,
    loadPiExtensionSettings,
} from "@zigai/pi-extension-settings/pi";
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
import modelModesSettingsDefinition, {
    defaultThinkingLevelSchema,
    modeThinkingLevelSchema,
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

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

function parseModesFileJson(value: unknown, label = "pi-model-modes config.json"): ModesFileJson {
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
    const parsed: unknown = Value.Parse(ModesFileJsonSchema, value);
    // SAFETY: Value.Errors returned no schema violations, so Value.Parse returns
    // the ModesFileJson represented by the same schema.
    return parsed as ModesFileJson;
}

function parseConfigObject(value: unknown, filePath: string): Record<string, unknown> {
    return Object.fromEntries(Object.entries(parseModesFileJson(value, filePath)));
}

function getLoadErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value as unknown;
    if (typeof code === "string") return code;
    return undefined;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function throwLoadError(filePath: string, error: unknown): never {
    throw new Error(`Failed to load ${filePath}: ${errorMessage(error)}`);
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

async function readConfigObject(filePath: string): Promise<Record<string, unknown>> {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        return parseConfigObject(parsedJson, filePath);
    } catch (cause: unknown) {
        if (getLoadErrorCode(cause) === "ENOENT") return {};
        throwLoadError(filePath, cause);
    }
}

export type ModesStoreContext = {
    readonly cwd: string;
    readonly projectTrusted: boolean;
};

export type SavedModes = {
    readonly data: ModesFile;
    readonly mtimeMs: number | null;
};

export class ModesStore {
    async resolvePath(context: ModesStoreContext): Promise<string> {
        await prepareModesConfig(context.cwd, context.projectTrusted);
        if (context.projectTrusted) {
            const projectPath = getProjectModesPath(context.cwd);
            if (await fileExists(projectPath)) return projectPath;
        }
        return getGlobalModesPath();
    }

    async load(
        filePath: string,
        fallbackMode: ModeSpec,
        options?: { readonly throwOnInvalid?: boolean },
    ): Promise<ModesFile> {
        if (filePath === getGlobalModesPath()) await scaffoldGlobalModesConfig();

        try {
            const raw = await fs.readFile(filePath, "utf8");
            const parsedJson: unknown = JSON.parse(raw);
            const parsed = parseModesFileJson(parsedJson);
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
            if (getLoadErrorCode(cause) === "ENOENT") return createDefaultModes(fallbackMode);
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
