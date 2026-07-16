import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    aliasModels,
    applyAlias,
    getAliasForLookup,
    getAliasForModel,
    resolveAliasesAgainstModels,
} from "./model-aliasing.ts";
import { getProviderDisplayName } from "./provider-aliasing.ts";
import type { BasicModelRegistry, LoadedConfig, ModelLike, RuntimeState } from "./types.ts";

const PATCH_MARKER = "__piModelAliasPatched";
const RUNTIME_KEY = "__piModelAliasRuntime";
const ORIGINAL_GET_ALL_KEY = "__piModelAliasOriginalGetAll";
const ORIGINAL_GET_AVAILABLE_KEY = "__piModelAliasOriginalGetAvailable";
const ORIGINAL_FIND_KEY = "__piModelAliasOriginalFind";
const ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY = "__piModelAliasOriginalGetProviderDisplayName";

export type PatchedModelRegistry = BasicModelRegistry & {
    [PATCH_MARKER]?: boolean;
    [RUNTIME_KEY]?: RuntimeState;
    [ORIGINAL_GET_ALL_KEY]?: () => ModelLike[];
    [ORIGINAL_GET_AVAILABLE_KEY]?: () => ModelLike[];
    [ORIGINAL_FIND_KEY]?: (provider: string, modelId: string) => ModelLike | undefined;
    [ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY]?: (provider: string) => string;
};

export function loadConfigForRegistry(
    state: RuntimeState,
    registry: PatchedModelRegistry,
): LoadedConfig {
    const loaded = state.loadSettings();
    if (loaded.error !== undefined || loaded.aliases.length === 0) {
        return loaded;
    }

    const nativeModels = registry[ORIGINAL_GET_ALL_KEY]?.call(registry) ?? [];
    return resolveAliasesAgainstModels(loaded, nativeModels);
}

function requireRegistryRuntime(runtime: RuntimeState | undefined): RuntimeState {
    if (runtime !== undefined) return runtime;
    throw new Error("Pi model alias runtime is not initialized.");
}

export function reportConfigError(
    state: RuntimeState,
    ctx: ExtensionContext,
    loaded: LoadedConfig,
): void {
    if (loaded.error === undefined) {
        state.reportedErrorKey = undefined;
        return;
    }

    const errorKey = `${loaded.path}:${loaded.mtimeMs}:${loaded.error}`;
    if (state.reportedErrorKey === errorKey) {
        return;
    }

    state.reportedErrorKey = errorKey;
    ctx.ui.notify(loaded.error, "error");
}

export function installRegistryPatch(registry: PatchedModelRegistry, state: RuntimeState): void {
    registry[RUNTIME_KEY] = state;

    if (
        typeof registry.getAll !== "function" ||
        typeof registry.getAvailable !== "function" ||
        typeof registry.find !== "function" ||
        typeof registry.getProviderDisplayName !== "function"
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
    registry[ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY] = Reflect.get(
        registry,
        "getProviderDisplayName",
    ) as (provider: string) => string;

    registry.getAll = function getAll(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_ALL_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        return aliasModels(models, loadConfigForRegistry(runtime, this));
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        return aliasModels(models, loadConfigForRegistry(runtime, this));
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_FIND_KEY] ?? registry[ORIGINAL_FIND_KEY];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        const loaded = loadConfigForRegistry(runtime, this);
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

    registry.getProviderDisplayName = function getProviderDisplayNameForAlias(
        this: PatchedModelRegistry,
        provider: string,
    ) {
        const originalGetProviderDisplayName =
            this[ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY] ??
            registry[ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY];
        const fallbackName = originalGetProviderDisplayName?.call(this, provider) ?? provider;
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        const loaded = loadConfigForRegistry(runtime, this);
        return getProviderDisplayName(provider, fallbackName, loaded);
    };
}
