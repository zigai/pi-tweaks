import { getAgentDir, ModelRegistry, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = join(getAgentDir(), "model-filters.json");
const PATCH_MARKER = "__providerModelFilterPatched";
const RUNTIME_KEY = "__providerModelFilterRuntime";
const ORIGINAL_GET_ALL_KEY = "__providerModelFilterOriginalGetAll";
const ORIGINAL_GET_AVAILABLE_KEY = "__providerModelFilterOriginalGetAvailable";
const ORIGINAL_FIND_KEY = "__providerModelFilterOriginalFind";

type ModelLike = {
    provider: string;
    id: string;
};

type FilterRuleConfig = {
    provider: string;
    models: string[];
};

type FilterConfig = {
    include?: FilterRuleConfig[];
    exclude?: FilterRuleConfig[];
};

type NormalizedRule = {
    providerPattern: string;
    providerRegex: RegExp;
    modelPatterns: string[];
    modelRegexes: RegExp[];
};

type LoadedConfig = {
    path: string;
    mtimeMs: number;
    includeRules: NormalizedRule[];
    excludeRules: NormalizedRule[];
    error?: string;
};

type RuntimeState = {
    configCache?: LoadedConfig;
    loadConfig: () => LoadedConfig;
};

type BasicModelRegistry = {
    getAll(): ModelLike[];
    getAvailable(): ModelLike[];
    find(provider: string, modelId: string): ModelLike | undefined;
};

type PatchedModelRegistry = BasicModelRegistry & {
    [PATCH_MARKER]?: boolean;
    [RUNTIME_KEY]?: RuntimeState;
    [ORIGINAL_GET_ALL_KEY]?: () => ModelLike[];
    [ORIGINAL_GET_AVAILABLE_KEY]?: () => ModelLike[];
    [ORIGINAL_FIND_KEY]?: (provider: string, modelId: string) => ModelLike | undefined;
};

function globToRegex(pattern: string): RegExp {
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

function validateRuleList(
    parsed: Record<string, unknown>,
    key: "include" | "exclude",
): FilterRuleConfig[] {
    const value = parsed[key];
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new Error(`"${key}" must be an array.`);
    }

    return value.map((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`${key}[${index}] must be an object.`);
        }

        const candidate = entry as Record<string, unknown>;
        let provider = "";
        if (typeof candidate.provider === "string") {
            provider = candidate.provider.trim();
        }
        if (provider.length === 0) {
            throw new Error(`${key}[${index}].provider must be a non-empty string.`);
        }

        if (!Array.isArray(candidate.models) || candidate.models.length === 0) {
            throw new Error(`${key}[${index}].models must be a non-empty array of strings.`);
        }

        const models = candidate.models.map((model, modelIndex) => {
            if (typeof model !== "string" || model.trim().length === 0) {
                throw new Error(
                    `${key}[${index}].models[${modelIndex}] must be a non-empty string.`,
                );
            }
            return model.trim();
        });

        return { provider, models };
    });
}

function validateConfig(config: unknown): FilterConfig {
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("Root value must be an object.");
    }

    const parsed = config as Record<string, unknown>;
    return {
        include: validateRuleList(parsed, "include"),
        exclude: validateRuleList(parsed, "exclude"),
    };
}

function normalizeRules(rules: FilterRuleConfig[]): NormalizedRule[] {
    return rules.map((rule) => ({
        providerPattern: rule.provider,
        providerRegex: globToRegex(rule.provider),
        modelPatterns: rule.models,
        modelRegexes: rule.models.map((model) => globToRegex(model)),
    }));
}

function findMatchingRule(
    model: ModelLike,
    rules: NormalizedRule[] | undefined,
): NormalizedRule | undefined {
    for (const rule of rules ?? []) {
        if (!rule.providerRegex.test(model.provider)) {
            continue;
        }
        if (rule.modelRegexes.some((regex) => regex.test(model.id))) {
            return rule;
        }
    }
    return undefined;
}

function hasIncludePolicy(model: ModelLike, rules: NormalizedRule[] | undefined): boolean {
    return (rules ?? []).some((rule) => rule.providerRegex.test(model.provider));
}

function isVisibleModel(model: ModelLike, loaded: LoadedConfig): boolean {
    if (hasIncludePolicy(model, loaded.includeRules)) {
        const includeRule = findMatchingRule(model, loaded.includeRules);
        if (includeRule === undefined) {
            return false;
        }
    }

    return findMatchingRule(model, loaded.excludeRules) === undefined;
}

function filterModels(models: ModelLike[], loaded: LoadedConfig): ModelLike[] {
    return models.filter((model) => isVisibleModel(model, loaded));
}

function safeReadConfig(state: RuntimeState): LoadedConfig {
    try {
        let mtimeMs = -1;
        try {
            mtimeMs = statSync(CONFIG_FILE).mtimeMs;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return {
                    path: CONFIG_FILE,
                    mtimeMs: -1,
                    includeRules: [],
                    excludeRules: [],
                };
            }
            throw error;
        }
        if (state.configCache?.mtimeMs === mtimeMs && state.configCache.error === undefined) {
            return state.configCache;
        }

        const raw = readFileSync(CONFIG_FILE, "utf8");
        const parsed = validateConfig(JSON.parse(raw));
        const loaded: LoadedConfig = {
            path: CONFIG_FILE,
            mtimeMs,
            includeRules: normalizeRules(parsed.include ?? []),
            excludeRules: normalizeRules(parsed.exclude ?? []),
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
            path: CONFIG_FILE,
            mtimeMs: -1,
            includeRules: [],
            excludeRules: [],
            error: `Failed to load ${CONFIG_FILE}: ${message}`,
        };
        state.configCache = loaded;
        return loaded;
    }
}

function installRegistryPatch(registry: PatchedModelRegistry, state: RuntimeState): void {
    registry[RUNTIME_KEY] = state;

    if (
        typeof registry.getAll !== "function" ||
        typeof registry.getAvailable !== "function" ||
        typeof registry.find !== "function"
    ) {
        throw new Error("Pi model registry does not expose the expected methods.");
    }

    if (registry[PATCH_MARKER] === true) {
        return;
    }

    registry[PATCH_MARKER] = true;
    registry[ORIGINAL_GET_ALL_KEY] = Reflect.get(registry, "getAll") as () => ModelLike[];
    registry[ORIGINAL_GET_AVAILABLE_KEY] = Reflect.get(
        registry,
        "getAvailable",
    ) as () => ModelLike[];
    registry[ORIGINAL_FIND_KEY] = Reflect.get(registry, "find") as (
        provider: string,
        modelId: string,
    ) => ModelLike | undefined;

    registry.getAll = function getAll(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_ALL_KEY]?.call(this) ?? [];
        const runtime = this[RUNTIME_KEY] ?? registry[RUNTIME_KEY];
        const loaded = runtime!.loadConfig();
        return filterModels(models, loaded);
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = this[RUNTIME_KEY] ?? registry[RUNTIME_KEY];
        const loaded = runtime!.loadConfig();
        return filterModels(models, loaded);
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_FIND_KEY] ?? registry[ORIGINAL_FIND_KEY];
        const model = finder?.call(this, provider, modelId);
        if (model === undefined) {
            return undefined;
        }

        const runtime = this[RUNTIME_KEY] ?? registry[RUNTIME_KEY];
        const loaded = runtime!.loadConfig();
        if (!isVisibleModel(model, loaded)) {
            return undefined;
        }
        return model;
    };
}

export default function providerModelFilterExtension(pi: ExtensionAPI) {
    const state: RuntimeState = {
        loadConfig: () => safeReadConfig(state),
    };

    installRegistryPatch(ModelRegistry.prototype as PatchedModelRegistry, state);

    pi.on("session_start", async (_event, ctx) => {
        installRegistryPatch(ctx.modelRegistry as PatchedModelRegistry, state);
    });
}
