import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import {
    getPiGlobalSettingsPath,
    getPiProjectSettingsPath,
    loadPiExtensionSettings,
} from "@zigai/pi-extension-settings/pi";
import { existsSync, statSync } from "node:fs";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import { normalizeRules, type FilterRuleConfig, type ModelFilterSettings } from "./model-filter.ts";

export const EXTENSION_ID = "pi-model-filter";
export const CONFIG_FILE = `${EXTENSION_ID}.json`;

export type LoadedModelFilterSettings = {
    path: string;
    mtimeMs: number;
    settings: ModelFilterSettings;
    diagnostic?: string;
};

export type ModelFilterSettingsLoadState = {
    configCache?: LoadedModelFilterSettings;
    configCwd?: string;
    projectTrusted?: boolean;
};

const nonBlankStringSchema = Type.String({ pattern: "\\S" });

export const filterRuleSchema = Type.Object(
    {
        provider: nonBlankStringSchema,
        models: Type.Array(nonBlankStringSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
);

export const modelFilterSettingsDefinition = defineExtensionSettings({
    id: EXTENSION_ID,
    title: "Pi Model Filter",
    description: "Settings for including and excluding models from Pi's model registry.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-model-filter/config.schema.json",
    schema: Type.Object(
        {
            include: Type.Array(filterRuleSchema, {
                default: [],
                description: "Provider and model glob rules that form inclusion allowlists.",
            }),
            exclude: Type.Array(filterRuleSchema, {
                default: [],
                description: "Provider and model glob rules that hide matching models.",
            }),
        },
        { additionalProperties: false },
    ),
    exampleSettings: {
        include: [{ provider: "openai-codex", models: ["gpt-5.*"] }],
        exclude: [{ provider: "openai-codex", models: ["*-mini"] }],
    },
});

export default modelFilterSettingsDefinition;

const FilterConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        include: Type.Optional(Type.Array(filterRuleSchema)),
        exclude: Type.Optional(Type.Array(filterRuleSchema)),
    },
    { additionalProperties: false },
);

type ParsedFilterRuleConfig = Static<typeof filterRuleSchema>;

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

function normalizeRule(rule: ParsedFilterRuleConfig): FilterRuleConfig {
    return {
        provider: rule.provider.trim(),
        models: rule.models.map((model) => model.trim()),
    };
}

export function decodeModelFilterSettings(config: unknown): ModelFilterSettings {
    const parsed = parseSchema(FilterConfigSchema, config, "pi-model-filter config.json");
    return {
        includeRules: normalizeRules((parsed.include ?? []).map(normalizeRule)),
        excludeRules: normalizeRules((parsed.exclude ?? []).map(normalizeRule)),
    };
}

export function getGlobalConfigPath(): string {
    return getPiGlobalSettingsPath(EXTENSION_ID);
}

export function getProjectConfigPath(cwd: string): string {
    return getPiProjectSettingsPath(EXTENSION_ID, cwd);
}

export function loadModelFilterSettings(
    state: ModelFilterSettingsLoadState,
): LoadedModelFilterSettings {
    const cwd = state.configCwd ?? process.cwd();
    const projectConfigPath = getProjectConfigPath(cwd);
    const loadedLayers = loadPiExtensionSettings(
        modelFilterSettingsDefinition,
        { cwd, isProjectTrusted: () => state.projectTrusted === true },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
    const useProjectConfig = state.projectTrusted === true && existsSync(projectConfigPath);
    let configPath = loadedLayers.globalConfigPath;
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
        const configDiagnostics = loadedLayers.diagnostics.filter(
            (diagnostic) => diagnostic.path === configPath && diagnostic.severity === "error",
        );
        if (configDiagnostics.length > 0) {
            throw new Error(configDiagnostics.map((diagnostic) => diagnostic.message).join("; "));
        }
        let layer = loadedLayers.globalSettingsLayer;
        if (useProjectConfig) layer = loadedLayers.projectSettingsLayer;
        const loaded: LoadedModelFilterSettings = {
            path: configPath,
            mtimeMs,
            settings: decodeModelFilterSettings(layer ?? {}),
        };
        state.configCache = loaded;
        return loaded;
    } catch (cause: unknown) {
        let message = String(cause);
        if (cause instanceof Error) message = cause.message;
        const loaded: LoadedModelFilterSettings = {
            path: configPath,
            mtimeMs,
            settings: { includeRules: [], excludeRules: [] },
            diagnostic: `Failed to load ${configPath}: ${message}`,
        };
        state.configCache = loaded;
        return loaded;
    }
}
