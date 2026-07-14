import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import {
    getPiGlobalSettingsPath,
    getPiProjectSettingsPath,
    loadPiExtensionSettings,
} from "@zigai/pi-extension-settings/pi";
import { existsSync, statSync } from "node:fs";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { AliasConfig, LoadedConfig, ProviderAliasConfig, RuntimeState } from "./types.ts";

export const EXTENSION_ID = "pi-model-alias";
export const CONFIG_FILE = `${EXTENSION_ID}.json`;

const nonBlankStringSchema = Type.String({ pattern: "\\S" });

export const aliasConfigSchema = Type.Object(
    {
        provider: nonBlankStringSchema,
        model: nonBlankStringSchema,
        alias: nonBlankStringSchema,
        name: Type.Optional(nonBlankStringSchema),
    },
    { additionalProperties: false },
);

export const providerAliasConfigSchema = Type.Object(
    {
        provider: nonBlankStringSchema,
        name: nonBlankStringSchema,
    },
    { additionalProperties: false },
);

export const modelAliasSettingsDefinition = defineExtensionSettings({
    id: EXTENSION_ID,
    title: "Pi Model Alias",
    description: "Settings for model and provider display aliases.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-model-alias/config.schema.json",
    schema: Type.Object(
        {
            aliases: Type.Array(aliasConfigSchema, {
                default: [],
                description: "Model alias entries matched by provider and model ID.",
            }),
            providerAliases: Type.Array(providerAliasConfigSchema, {
                default: [],
                description: "Provider display-name aliases.",
            }),
            stableProviderColumn: Type.Boolean({
                default: true,
                description: "Keep the provider column stable when aliases are displayed.",
            }),
        },
        { additionalProperties: false },
    ),
});

export default modelAliasSettingsDefinition;

const ModelAliasesConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        aliases: Type.Optional(Type.Array(aliasConfigSchema)),
        providerAliases: Type.Optional(Type.Array(providerAliasConfigSchema)),
        stableProviderColumn: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);

type ParsedAliasConfig = Static<typeof aliasConfigSchema>;
type ParsedProviderAliasConfig = Static<typeof providerAliasConfigSchema>;

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
    return getPiGlobalSettingsPath(EXTENSION_ID);
}

export function getProjectConfigPath(cwd: string): string {
    return getPiProjectSettingsPath(EXTENSION_ID, cwd);
}

export function loadModelAliasSettings(state: RuntimeState): LoadedConfig {
    const cwd = state.configCwd ?? process.cwd();
    const projectConfigPath = getProjectConfigPath(cwd);
    const settings = loadPiExtensionSettings(
        modelAliasSettingsDefinition,
        { cwd, isProjectTrusted: () => state.projectTrusted === true },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
    const useProjectConfig = state.projectTrusted === true && existsSync(projectConfigPath);
    let configPath = settings.globalConfigPath;
    if (useProjectConfig) configPath = projectConfigPath;
    let mtimeMs = -1;
    try {
        mtimeMs = statSync(configPath).mtimeMs;
    } catch {
        // A scaffold failure is surfaced through the loader diagnostics below.
    }

    if (state.configCache?.path === configPath && state.configCache.mtimeMs === mtimeMs) {
        return state.configCache;
    }

    try {
        const configDiagnostics = settings.diagnostics.filter(
            (diagnostic) => diagnostic.path === configPath && diagnostic.severity === "error",
        );
        if (configDiagnostics.length > 0) {
            throw new Error(configDiagnostics.map((diagnostic) => diagnostic.message).join("; "));
        }
        let layer = settings.globalSettingsLayer;
        if (useProjectConfig) layer = settings.projectSettingsLayer;
        const parsed = parseModelAliasesConfig(layer ?? {});
        const loaded: LoadedConfig = {
            path: configPath,
            mtimeMs,
            aliases: parsed.aliases,
            providerAliases: parsed.providerAliases,
            stableProviderColumn: parsed.stableProviderColumn,
        };
        state.configCache = loaded;
        return loaded;
    } catch (error: unknown) {
        let message = String(error);
        if (error instanceof Error) message = error.message;
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
