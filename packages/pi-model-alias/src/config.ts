import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { AliasConfig, LoadedConfig, ProviderAliasConfig, RuntimeState } from "./types.ts";

export const EXTENSION_ID = "pi-model-alias";
export const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";

const NonBlankString = Type.String({ pattern: "\\S" });

const AliasConfigSchema = Type.Object(
    {
        provider: NonBlankString,
        model: NonBlankString,
        alias: NonBlankString,
        name: Type.Optional(NonBlankString),
    },
    { additionalProperties: false },
);

const ProviderAliasConfigSchema = Type.Object(
    {
        provider: NonBlankString,
        name: NonBlankString,
    },
    { additionalProperties: false },
);

const ModelAliasesConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        aliases: Type.Optional(Type.Array(AliasConfigSchema)),
        providerAliases: Type.Optional(Type.Array(ProviderAliasConfigSchema)),
        stableProviderColumn: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);

type ParsedAliasConfig = Static<typeof AliasConfigSchema>;
type ParsedProviderAliasConfig = Static<typeof ProviderAliasConfigSchema>;
type ParsedModelAliasesConfig = Static<typeof ModelAliasesConfigSchema>;

const DEFAULT_MODEL_ALIASES_CONFIG: ParsedModelAliasesConfig = {
    $schema: `./${SCHEMA_FILE}`,
    aliases: [],
    providerAliases: [],
    stableProviderColumn: true,
};

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

function parseSchema<Schema extends TSchema>(
    schema: Schema,
    value: unknown,
    label: string,
): Static<Schema> {
    const errors = [...Value.Errors(schema, value)];
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
    const parsed: unknown = Value.Parse(schema, value);
    // SAFETY: Value.Errors returned no schema violations, so Value.Parse returns
    // the TypeBox static type represented by the same schema.
    // oxlint-disable-next-line typescript/no-unsafe-return -- SAFETY: TypeBox exposes parsed schema output through a conditional static type that oxlint treats as any here.
    return parsed as Static<Schema>;
}

function normalizeAliasConfig(entry: ParsedAliasConfig): AliasConfig {
    const normalized: AliasConfig = {
        provider: entry.provider.trim(),
        model: entry.model.trim(),
        alias: entry.alias.trim(),
    };
    if (entry.name !== undefined) {
        normalized.name = entry.name.trim();
    }
    return normalized;
}

function normalizeProviderAliasConfig(entry: ParsedProviderAliasConfig): ProviderAliasConfig {
    return {
        provider: entry.provider.trim(),
        name: entry.name.trim(),
    };
}

function validateUniqueAliases(aliases: AliasConfig[]): void {
    const seenAliases = new Map<string, number>();
    aliases.forEach((entry, index) => {
        const aliasKey = `${entry.provider}\0${entry.alias}`;
        const duplicateIndex = seenAliases.get(aliasKey);
        if (duplicateIndex !== undefined) {
            throw new Error(
                `aliases[${index}] duplicates aliases[${duplicateIndex}] for provider "${entry.provider}" and alias "${entry.alias}".`,
            );
        }
        seenAliases.set(aliasKey, index);
    });
}

function validateUniqueProviderAliases(providerAliases: ProviderAliasConfig[]): void {
    const seenProviders = new Map<string, number>();
    providerAliases.forEach((entry, index) => {
        const duplicateIndex = seenProviders.get(entry.provider);
        if (duplicateIndex !== undefined) {
            throw new Error(
                `providerAliases[${index}] duplicates providerAliases[${duplicateIndex}] for provider "${entry.provider}".`,
            );
        }
        seenProviders.set(entry.provider, index);
    });
}

function parseModelAliasesConfig(config: unknown): {
    aliases: AliasConfig[];
    providerAliases: ProviderAliasConfig[];
    stableProviderColumn: boolean;
} {
    const parsed = parseSchema(ModelAliasesConfigSchema, config, "pi-model-alias config.json");
    const aliases = (parsed.aliases ?? []).map(normalizeAliasConfig);
    const providerAliases = (parsed.providerAliases ?? []).map(normalizeProviderAliasConfig);
    validateUniqueAliases(aliases);
    validateUniqueProviderAliases(providerAliases);
    return {
        aliases,
        providerAliases,
        stableProviderColumn: parsed.stableProviderColumn ?? true,
    };
}

export function getGlobalConfigPath(): string {
    return join(getAgentDir(), EXTENSION_ID, CONFIG_FILE);
}

export function getProjectConfigPath(cwd: string): string {
    return join(cwd, CONFIG_DIR_NAME, EXTENSION_ID, CONFIG_FILE);
}

function getSchemaPath(configPath: string): string {
    return join(dirname(configPath), SCHEMA_FILE);
}

function writeIfMissing(filePath: string, content: string): void {
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
    } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST") return;
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

function refreshSchemaFile(filePath: string, content: string): void {
    let temporaryPath: string | undefined;
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        try {
            if (readFileSync(filePath, "utf8") === content) return;
        } catch (error: unknown) {
            if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }

        const nextTemporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        writeFileSync(nextTemporaryPath, content, { encoding: "utf8", flag: "wx" });
        temporaryPath = nextTemporaryPath;
        renameSync(temporaryPath, filePath);
        temporaryPath = undefined;
    } catch (error: unknown) {
        if (temporaryPath !== undefined) {
            try {
                unlinkSync(temporaryPath);
            } catch {
                // Ignore cleanup failure while reporting the original scaffold failure.
            }
        }
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

function readBundledSchema(): string | undefined {
    try {
        return readFileSync(new URL("../config.schema.json", import.meta.url), "utf8");
    } catch {
        return undefined;
    }
}

function scaffoldGlobalConfig(): void {
    const globalConfigPath = getGlobalConfigPath();
    const schema = readBundledSchema();
    if (schema !== undefined) {
        refreshSchemaFile(getSchemaPath(globalConfigPath), schema);
    }
    writeIfMissing(globalConfigPath, `${JSON.stringify(DEFAULT_MODEL_ALIASES_CONFIG, null, 2)}\n`);
}

function getConfigPath(state: RuntimeState): string {
    if (state.projectTrusted === true && state.configCwd !== undefined) {
        const projectConfigPath = getProjectConfigPath(state.configCwd);
        if (existsSync(projectConfigPath)) return projectConfigPath;
    }
    return getGlobalConfigPath();
}

export function safeReadConfig(state: RuntimeState): LoadedConfig {
    scaffoldGlobalConfig();
    const configPath = getConfigPath(state);
    let mtimeMs = -1;
    try {
        try {
            mtimeMs = statSync(configPath).mtimeMs;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                const loaded: LoadedConfig = {
                    path: configPath,
                    mtimeMs: -1,
                    aliases: [],
                    providerAliases: [],
                    stableProviderColumn: true,
                };
                state.configCache = loaded;
                return loaded;
            }
            throw error;
        }
        if (state.configCache?.path === configPath && state.configCache.mtimeMs === mtimeMs) {
            return state.configCache;
        }

        const raw = readFileSync(configPath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        const parsed = parseModelAliasesConfig(parsedJson);
        const loaded: LoadedConfig = {
            path: configPath,
            mtimeMs,
            aliases: parsed.aliases,
            providerAliases: parsed.providerAliases,
            stableProviderColumn: parsed.stableProviderColumn,
        };
        state.configCache = loaded;
        return loaded;
    } catch (error) {
        let message: string;
        if (error instanceof Error) {
            message = error.message;
        } else {
            message = String(error);
        }
        const loaded: LoadedConfig = {
            path: configPath,
            mtimeMs,
            aliases: [],
            providerAliases: [],
            stableProviderColumn: true,
            error: `Failed to load ${configPath}: ${message}`,
        };
        state.configCache = loaded;
        return loaded;
    }
}
