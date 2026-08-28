import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    aliasModels,
    applyAlias,
    getAliasForLookup,
    getAliasForModel,
    getAliasModelIdCollision,
    type ModelLike,
} from "./model-aliasing.ts";
import { getProviderDisplayName } from "./provider-aliasing.ts";
import type { LoadedModelAliasSettings } from "./settings.ts";

const PATCH_MARKER = "__piModelAliasPatched";
const RUNTIME_KEY = "__piModelAliasRuntime";
const ORIGINAL_GET_ALL_KEY = "__piModelAliasOriginalGetAll";
const ORIGINAL_GET_AVAILABLE_KEY = "__piModelAliasOriginalGetAvailable";
const ORIGINAL_FIND_KEY = "__piModelAliasOriginalFind";
const ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY = "__piModelAliasOriginalGetProviderDisplayName";

export type ModelAliasRuntimeState = {
    loadSettings: () => LoadedModelAliasSettings;
    validatedConfig?: {
        source: LoadedModelAliasSettings;
        loaded: LoadedModelAliasSettings;
    };
    reportedDiagnosticKey?: string;
};

export type BasicModelRegistry = {
    getAll: () => ModelLike[];
    getAvailable: () => ModelLike[];
    find: (provider: string, modelId: string) => ModelLike | undefined;
    getProviderDisplayName: (provider: string) => string;
};

export type PatchedModelRegistry = BasicModelRegistry & {
    [PATCH_MARKER]?: boolean;
    [RUNTIME_KEY]?: ModelAliasRuntimeState;
    [ORIGINAL_GET_ALL_KEY]?: () => ModelLike[];
    [ORIGINAL_GET_AVAILABLE_KEY]?: () => ModelLike[];
    [ORIGINAL_FIND_KEY]?: (provider: string, modelId: string) => ModelLike | undefined;
    [ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY]?: (provider: string) => string;
};

export function loadConfigForRegistry(
    state: ModelAliasRuntimeState,
    registry: PatchedModelRegistry,
    refreshModels = false,
): LoadedModelAliasSettings {
    const loaded = state.loadSettings();
    if (!refreshModels && state.validatedConfig?.source === loaded) {
        return state.validatedConfig.loaded;
    }

    let validated = loaded;
    if (loaded.diagnostic === undefined && loaded.settings.aliases.length > 0) {
        const nativeModels = registry[ORIGINAL_GET_ALL_KEY]?.call(registry) ?? [];
        const collision = getAliasModelIdCollision(loaded.settings, nativeModels);
        if (collision !== undefined) {
            validated = {
                ...loaded,
                settings: {
                    ...loaded.settings,
                    aliases: [],
                    providerAliases: [],
                },
                diagnostic: `Failed to load ${loaded.path}: ${collision}`,
            };
        }
    }

    state.validatedConfig = { source: loaded, loaded: validated };
    return validated;
}

function requireRegistryRuntime(
    runtime: ModelAliasRuntimeState | undefined,
): ModelAliasRuntimeState {
    if (runtime !== undefined) return runtime;
    throw new Error("Pi model alias runtime is not initialized.");
}

export function reportConfigError(
    state: ModelAliasRuntimeState,
    ctx: ExtensionContext,
    loaded: LoadedModelAliasSettings,
): void {
    if (loaded.diagnostic === undefined) {
        state.reportedDiagnosticKey = undefined;
        return;
    }

    const diagnosticKey = `${loaded.path}:${loaded.mtimeMs}:${loaded.diagnostic}`;
    if (state.reportedDiagnosticKey === diagnosticKey) return;

    state.reportedDiagnosticKey = diagnosticKey;
    ctx.ui.notify(loaded.diagnostic, "error");
}

export function installRegistryPatch(
    registry: PatchedModelRegistry,
    state: ModelAliasRuntimeState,
): void {
    registry[RUNTIME_KEY] = state;

    if (
        typeof registry.getAll !== "function" ||
        typeof registry.getAvailable !== "function" ||
        typeof registry.find !== "function" ||
        typeof registry.getProviderDisplayName !== "function"
    ) {
        throw new Error("Pi model registry does not expose the expected methods.");
    }

    if (registry[PATCH_MARKER] === true) return;

    registry[PATCH_MARKER] = true;
    registry[ORIGINAL_GET_ALL_KEY] = registry.getAll;
    registry[ORIGINAL_GET_AVAILABLE_KEY] = registry.getAvailable;
    registry[ORIGINAL_FIND_KEY] = registry.find;
    registry[ORIGINAL_GET_PROVIDER_DISPLAY_NAME_KEY] = registry.getProviderDisplayName;

    registry.getAll = function getAll(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_ALL_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        return aliasModels(models, loadConfigForRegistry(runtime, this).settings);
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        return aliasModels(models, loadConfigForRegistry(runtime, this).settings);
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_FIND_KEY] ?? registry[ORIGINAL_FIND_KEY];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        const settings = loadConfigForRegistry(runtime, this).settings;
        const alias = getAliasForLookup(provider, modelId, settings);
        if (alias !== undefined) {
            const target = finder?.call(this, provider, alias.model);
            if (target === undefined) return undefined;
            return applyAlias(target, alias);
        }

        const model = finder?.call(this, provider, modelId);
        if (model === undefined) return undefined;
        const modelAlias = getAliasForModel(model, settings);
        if (modelAlias === undefined) return model;
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
        const settings = loadConfigForRegistry(runtime, this).settings;
        return getProviderDisplayName(provider, fallbackName, settings);
    };
}
