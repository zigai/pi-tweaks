import {
    ModelRegistry,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
    filterModels,
    isVisibleModel,
    loadModelFilterSettings,
    setConfigContext,
    type LoadedConfig,
    type ModelLike,
    type RuntimeState,
} from "./settings.ts";

export * from "./settings.ts";

const PATCH_MARKER = "__providerModelFilterPatched";
const RUNTIME_KEY = "__providerModelFilterRuntime";
const ORIGINAL_GET_ALL_KEY = "__providerModelFilterOriginalGetAll";
const ORIGINAL_GET_AVAILABLE_KEY = "__providerModelFilterOriginalGetAvailable";
const ORIGINAL_FIND_KEY = "__providerModelFilterOriginalFind";

export type BasicModelRegistry = {
    getAll(): ModelLike[];
    getAvailable(): ModelLike[];
    find(provider: string, modelId: string): ModelLike | undefined;
};

export type PatchedModelRegistry = BasicModelRegistry & {
    [PATCH_MARKER]?: boolean;
    [RUNTIME_KEY]?: RuntimeState;
    [ORIGINAL_GET_ALL_KEY]?: () => ModelLike[];
    [ORIGINAL_GET_AVAILABLE_KEY]?: () => ModelLike[];
    [ORIGINAL_FIND_KEY]?: (provider: string, modelId: string) => ModelLike | undefined;
};

function requireRegistryRuntime(runtime: RuntimeState | undefined): RuntimeState {
    if (runtime !== undefined) return runtime;
    throw new Error("Pi model filter runtime is not initialized.");
}

function reportConfigError(state: RuntimeState, ctx: ExtensionContext, loaded: LoadedConfig): void {
    if (loaded.error === undefined) {
        state.reportedErrorKey = undefined;
        return;
    }

    const errorKey = `${loaded.path}:${loaded.mtimeMs}:${loaded.error}`;
    if (state.reportedErrorKey === errorKey) return;

    state.reportedErrorKey = errorKey;
    ctx.ui.notify(loaded.error, "error");
}

export function installRegistryPatch(registry: PatchedModelRegistry, state: RuntimeState): void {
    registry[RUNTIME_KEY] = state;

    if (
        typeof registry.getAll !== "function" ||
        typeof registry.getAvailable !== "function" ||
        typeof registry.find !== "function"
    ) {
        throw new Error("Pi model registry does not expose the expected methods.");
    }

    if (registry[PATCH_MARKER] === true) return;

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
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        return filterModels(models, runtime.loadSettings());
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        return filterModels(models, runtime.loadSettings());
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_FIND_KEY] ?? registry[ORIGINAL_FIND_KEY];
        const model = finder?.call(this, provider, modelId);
        if (model === undefined) return undefined;

        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        if (!isVisibleModel(model, runtime.loadSettings())) return undefined;
        return model;
    };
}

export default function providerModelFilterExtension(pi: ExtensionAPI) {
    const state: RuntimeState = {
        loadSettings: () => loadModelFilterSettings(state),
    };

    installRegistryPatch(ModelRegistry.prototype as PatchedModelRegistry, state);

    pi.on("session_start", async (_event, ctx) => {
        setConfigContext(state, ctx);
        installRegistryPatch(ctx.modelRegistry as PatchedModelRegistry, state);
        reportConfigError(state, ctx, state.loadSettings());
    });

    pi.on("turn_start", (_event, ctx) => {
        setConfigContext(state, ctx);
        reportConfigError(state, ctx, state.loadSettings());
    });
}
