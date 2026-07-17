import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import {
    getPiGlobalSettingsPath,
    getPiProjectSettingsPath,
    loadPiExtensionSettings,
} from "@zigai/pi-extension-settings/pi";
import { existsSync, statSync } from "node:fs";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const EXTENSION_ID = "pi-model-filter";
export const CONFIG_FILE = `${EXTENSION_ID}.json`;

export type ModelLike = {
    provider: string;
    id: string;
};

export type FilterRuleConfig = {
    provider: string;
    models: string[];
};

export type FilterConfig = {
    include?: FilterRuleConfig[];
    exclude?: FilterRuleConfig[];
};

export type NormalizedRule = {
    providerPattern: string;
    providerRegex: RegExp;
    modelPatterns: string[];
    modelRegexes: RegExp[];
};

export type LoadedConfig = {
    path: string;
    mtimeMs: number;
    includeRules: NormalizedRule[];
    excludeRules: NormalizedRule[];
    error?: string;
};

export type RuntimeState = {
    configCache?: LoadedConfig;
    configCwd?: string;
    projectTrusted?: boolean;
    reportedErrorKey?: string;
    loadSettings: () => LoadedConfig;
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

type ProjectTrustContext = ExtensionContext & {
    isProjectTrusted?: () => boolean;
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

function normalizeRule(rule: ParsedFilterRuleConfig): FilterRuleConfig {
    return {
        provider: rule.provider.trim(),
        models: rule.models.map((model) => model.trim()),
    };
}

function parseFilterConfig(config: unknown): FilterConfig {
    const parsed = parseSchema(FilterConfigSchema, config, "pi-model-filter config.json");
    return {
        include: (parsed.include ?? []).map(normalizeRule),
        exclude: (parsed.exclude ?? []).map(normalizeRule),
    };
}

function isProjectTrusted(ctx: ExtensionContext): boolean {
    return (ctx as ProjectTrustContext).isProjectTrusted?.() ?? true;
}

function findMatchingRule(
    model: ModelLike,
    rules: NormalizedRule[] | undefined,
): NormalizedRule | undefined {
    for (const rule of rules ?? []) {
        if (!rule.providerRegex.test(model.provider)) continue;
        if (rule.modelRegexes.some((regex) => regex.test(model.id))) return rule;
    }
    return undefined;
}

function hasIncludePolicy(model: ModelLike, rules: NormalizedRule[] | undefined): boolean {
    return (rules ?? []).some((rule) => rule.providerRegex.test(model.provider));
}

export function globToRegex(pattern: string): RegExp {
    let regex = "";
    for (const character of pattern) {
        if (character === "*") {
            regex += ".*";
        } else if (character === "?") {
            regex += ".";
        } else {
            regex += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
        }
    }
    return new RegExp(`^${regex}$`);
}

export function normalizeRules(rules: FilterRuleConfig[]): NormalizedRule[] {
    return rules.map((rule) => ({
        providerPattern: rule.provider,
        providerRegex: globToRegex(rule.provider),
        modelPatterns: rule.models,
        modelRegexes: rule.models.map((model) => globToRegex(model)),
    }));
}

export function isVisibleModel(model: ModelLike, loaded: LoadedConfig): boolean {
    if (hasIncludePolicy(model, loaded.includeRules)) {
        const includeRule = findMatchingRule(model, loaded.includeRules);
        if (includeRule === undefined) return false;
    }

    return findMatchingRule(model, loaded.excludeRules) === undefined;
}

export function filterModels(models: readonly ModelLike[], loaded: LoadedConfig): ModelLike[] {
    return models.filter((model) => isVisibleModel(model, loaded));
}

export function getGlobalConfigPath(): string {
    return getPiGlobalSettingsPath(EXTENSION_ID);
}

export function getProjectConfigPath(cwd: string): string {
    return getPiProjectSettingsPath(EXTENSION_ID, cwd);
}

export function setConfigContext(state: RuntimeState, ctx: ExtensionContext): void {
    const projectTrusted = isProjectTrusted(ctx);
    if (state.configCwd !== ctx.cwd || state.projectTrusted !== projectTrusted) {
        state.configCache = undefined;
    }
    state.configCwd = ctx.cwd;
    state.projectTrusted = projectTrusted;
}

export function loadModelFilterSettings(state: RuntimeState): LoadedConfig {
    const cwd = state.configCwd ?? process.cwd();
    const projectConfigPath = getProjectConfigPath(cwd);
    const settings = loadPiExtensionSettings(
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
        const parsed = parseFilterConfig(layer ?? {});
        const loaded: LoadedConfig = {
            path: configPath,
            mtimeMs,
            includeRules: normalizeRules(parsed.include ?? []),
            excludeRules: normalizeRules(parsed.exclude ?? []),
        };
        state.configCache = loaded;
        return loaded;
    } catch (cause: unknown) {
        let message = String(cause);
        if (cause instanceof Error) message = cause.message;
        const loaded: LoadedConfig = {
            path: configPath,
            mtimeMs,
            includeRules: [],
            excludeRules: [],
            error: `Failed to load ${configPath}: ${message}`,
        };
        state.configCache = loaded;
        return loaded;
    }
}
