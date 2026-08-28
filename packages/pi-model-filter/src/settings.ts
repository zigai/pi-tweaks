import {
    getPiGlobalSettingsPath,
    getPiProjectSettingsPath,
    loadPiExtensionSettings,
} from "@zigai/pi-extension-settings/pi";

import { existsSync, statSync } from "node:fs";

import { Type, type Static } from "typebox";

import { Value } from "typebox/value";

import { definePrevalidatedExtensionSettings } from "@zigai/pi-extension-settings/runtime";
import { normalizeRules, type FilterRuleConfig, type ModelFilterSettings } from "./model-filter.ts";
import {
    EXTENSION_ID,
    LoadedModelFilterSettings,
    ModelFilterSettingsLoadState,
    extensionSettingsInput,
    filterRuleSchema,
} from "./settings-input.ts";
import prevalidatedSettings from "./settings.prevalidated.ts";

export * from "./settings-input.ts";

export const modelFilterSettingsDefinition = definePrevalidatedExtensionSettings(
    extensionSettingsInput,
    prevalidatedSettings,
);

export default modelFilterSettingsDefinition;

const FilterConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        include: Type.Optional(Type.Array(filterRuleSchema)),
        exclude: Type.Optional(Type.Array(filterRuleSchema)),
    },
    { additionalProperties: false },
);

type ParsedFilterConfig = Static<typeof FilterConfigSchema>;
type ParsedFilterRuleConfig = Static<typeof filterRuleSchema>;

function normalizeRule(rule: ParsedFilterRuleConfig): FilterRuleConfig {
    return {
        provider: rule.provider.trim(),
        models: rule.models.map((model) => model.trim()),
    };
}

export function decodeModelFilterSettings(config: ParsedFilterConfig): ModelFilterSettings {
    return {
        includeRules: normalizeRules((config.include ?? []).map(normalizeRule)),
        excludeRules: normalizeRules((config.exclude ?? []).map(normalizeRule)),
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
            settings: decodeModelFilterSettings(Value.Parse(FilterConfigSchema, layer ?? {})),
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
