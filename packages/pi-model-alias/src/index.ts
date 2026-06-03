import { getAgentDir, ModelRegistry, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = join(getAgentDir(), "model-aliases.json");
const PATCH_MARKER = "__piModelAliasPatched";
const RUNTIME_KEY = "__piModelAliasRuntime";
const ORIGINAL_GET_ALL_KEY = "__piModelAliasOriginalGetAll";
const ORIGINAL_GET_AVAILABLE_KEY = "__piModelAliasOriginalGetAvailable";
const ORIGINAL_FIND_KEY = "__piModelAliasOriginalFind";

type ModelLike = {
    provider: string;
    id: string;
    name?: string;
};

type AliasConfig = {
    provider: string;
    model: string;
    alias: string;
    name?: string;
};

type ModelAliasesConfig = {
    aliases?: AliasConfig[];
};

type LoadedConfig = {
    path: string;
    mtimeMs: number;
    aliases: AliasConfig[];
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

function readRequiredString(
    candidate: Record<string, unknown>,
    key: string,
    index: number,
): string {
    const value = candidate[key];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`aliases[${index}].${key} must be a non-empty string.`);
    }
    return value.trim();
}

function readOptionalString(
    candidate: Record<string, unknown>,
    key: string,
    index: number,
): string | undefined {
    const value = candidate[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`aliases[${index}].${key} must be a non-empty string when provided.`);
    }
    return value.trim();
}

function validateAliasList(parsed: Record<string, unknown>): AliasConfig[] {
    const value = parsed.aliases;
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new Error('"aliases" must be an array.');
    }

    return value.map((entry, index) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`aliases[${index}] must be an object.`);
        }

        const candidate = entry as Record<string, unknown>;
        const provider = readRequiredString(candidate, "provider", index);
        const model = readRequiredString(candidate, "model", index);
        const alias = readRequiredString(candidate, "alias", index);
        const name = readOptionalString(candidate, "name", index);
        return { provider, model, alias, name };
    });
}

function validateConfig(config: unknown): ModelAliasesConfig {
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("Root value must be an object.");
    }

    const parsed = config as Record<string, unknown>;
    return {
        aliases: validateAliasList(parsed),
    };
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
                    aliases: [],
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
            aliases: parsed.aliases ?? [],
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
            aliases: [],
            error: `Failed to load ${CONFIG_FILE}: ${message}`,
        };
        state.configCache = loaded;
        return loaded;
    }
}

function getAliasForModel(model: ModelLike, loaded: LoadedConfig): AliasConfig | undefined {
    return loaded.aliases.find(
        (alias) => alias.provider === model.provider && alias.model === model.id,
    );
}

function getAliasForLookup(
    provider: string,
    modelId: string,
    loaded: LoadedConfig,
): AliasConfig | undefined {
    return loaded.aliases.find((alias) => alias.provider === provider && alias.alias === modelId);
}

function applyAlias(model: ModelLike, alias: AliasConfig): ModelLike {
    return {
        ...model,
        id: alias.alias,
        name: alias.name ?? alias.alias,
    };
}

function aliasModels(models: ModelLike[], loaded: LoadedConfig): ModelLike[] {
    if (loaded.error !== undefined || loaded.aliases.length === 0) {
        return models;
    }

    return models.map((model) => {
        const alias = getAliasForModel(model, loaded);
        if (alias === undefined) {
            return model;
        }
        return applyAlias(model, alias);
    });
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
        return aliasModels(models, runtime!.loadConfig());
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = this[RUNTIME_KEY] ?? registry[RUNTIME_KEY];
        return aliasModels(models, runtime!.loadConfig());
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_FIND_KEY] ?? registry[ORIGINAL_FIND_KEY];
        const runtime = this[RUNTIME_KEY] ?? registry[RUNTIME_KEY];
        const loaded = runtime!.loadConfig();
        const alias = getAliasForLookup(provider, modelId, loaded);
        if (alias !== undefined) {
            const target = finder?.call(this, provider, alias.model);
            if (target === undefined) {
                return undefined;
            }
            return applyAlias(target, alias);
        }

        const model = finder?.call(this, provider, modelId);
        if (model === undefined) {
            return undefined;
        }
        const modelAlias = getAliasForModel(model, loaded);
        if (modelAlias === undefined) {
            return model;
        }
        return applyAlias(model, modelAlias);
    };
}

function rewritePayloadModel(payload: unknown, targetModel: string): unknown {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return payload;
    }
    return {
        ...(payload as Record<string, unknown>),
        model: targetModel,
    };
}

export default function modelAliasExtension(pi: ExtensionAPI) {
    const state: RuntimeState = {
        loadConfig: () => safeReadConfig(state),
    };

    installRegistryPatch(ModelRegistry.prototype as PatchedModelRegistry, state);

    pi.on("session_start", async (_event, ctx) => {
        installRegistryPatch(ctx.modelRegistry as PatchedModelRegistry, state);
    });

    pi.on("before_provider_request", (event, ctx) => {
        if (ctx.model === undefined) {
            return undefined;
        }
        const loaded = state.loadConfig();
        const alias = getAliasForLookup(ctx.model.provider, ctx.model.id, loaded);
        if (alias === undefined) {
            return undefined;
        }
        return rewritePayloadModel(event.payload, alias.model);
    });
}
