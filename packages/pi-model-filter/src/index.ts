import {
    ModelRegistry,
    ModelRuntime,
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

const REGISTRY_PATCH_MARKER = Symbol.for("@zigai/pi-model-filter/registry-patched");
const REGISTRY_RUNTIME_KEY = Symbol.for("@zigai/pi-model-filter/registry-runtime");
const ORIGINAL_REGISTRY_GET_ALL_KEY = Symbol.for("@zigai/pi-model-filter/registry-get-all");
const ORIGINAL_REGISTRY_GET_AVAILABLE_KEY = Symbol.for(
    "@zigai/pi-model-filter/registry-get-available",
);
const ORIGINAL_REGISTRY_FIND_KEY = Symbol.for("@zigai/pi-model-filter/registry-find");
const MODEL_RUNTIME_PATCH_MARKER = Symbol.for("@zigai/pi-model-filter/model-runtime-patched");
const MODEL_RUNTIME_STATE_KEY = Symbol.for("@zigai/pi-model-filter/model-runtime-state");
const ORIGINAL_RUNTIME_GET_MODELS_KEY = Symbol.for(
    "@zigai/pi-model-filter/model-runtime-get-models",
);
const ORIGINAL_RUNTIME_GET_AVAILABLE_KEY = Symbol.for(
    "@zigai/pi-model-filter/model-runtime-get-available",
);
const ORIGINAL_RUNTIME_GET_AVAILABLE_SNAPSHOT_KEY = Symbol.for(
    "@zigai/pi-model-filter/model-runtime-get-available-snapshot",
);
const ORIGINAL_RUNTIME_GET_MODEL_KEY = Symbol.for("@zigai/pi-model-filter/model-runtime-get-model");

export type BasicModelRegistry = {
    getAll(): ModelLike[];
    getAvailable(): ModelLike[];
    find(provider: string, modelId: string): ModelLike | undefined;
};

export type PatchedModelRegistry = BasicModelRegistry & {
    [REGISTRY_PATCH_MARKER]?: boolean;
    [REGISTRY_RUNTIME_KEY]?: RuntimeState;
    [ORIGINAL_REGISTRY_GET_ALL_KEY]?: () => ModelLike[];
    [ORIGINAL_REGISTRY_GET_AVAILABLE_KEY]?: () => ModelLike[];
    [ORIGINAL_REGISTRY_FIND_KEY]?: (provider: string, modelId: string) => ModelLike | undefined;
};

export type BasicModelRuntime = {
    getModels(providerId?: string): readonly ModelLike[];
    getAvailable(providerId?: string): Promise<readonly ModelLike[]>;
    getAvailableSnapshot(): readonly ModelLike[];
    getModel(providerId: string, modelId: string): ModelLike | undefined;
};

export type PatchedModelRuntime = BasicModelRuntime & {
    [MODEL_RUNTIME_PATCH_MARKER]?: boolean;
    [MODEL_RUNTIME_STATE_KEY]?: RuntimeState;
    [ORIGINAL_RUNTIME_GET_MODELS_KEY]?: (providerId?: string) => readonly ModelLike[];
    [ORIGINAL_RUNTIME_GET_AVAILABLE_KEY]?: (providerId?: string) => Promise<readonly ModelLike[]>;
    [ORIGINAL_RUNTIME_GET_AVAILABLE_SNAPSHOT_KEY]?: () => readonly ModelLike[];
    [ORIGINAL_RUNTIME_GET_MODEL_KEY]?: (
        providerId: string,
        modelId: string,
    ) => ModelLike | undefined;
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
    registry[REGISTRY_RUNTIME_KEY] = state;

    if (
        typeof registry.getAll !== "function" ||
        typeof registry.getAvailable !== "function" ||
        typeof registry.find !== "function"
    ) {
        throw new Error("Pi model registry does not expose the expected methods.");
    }

    if (registry[REGISTRY_PATCH_MARKER] === true) return;

    registry[ORIGINAL_REGISTRY_GET_ALL_KEY] = Reflect.get(registry, "getAll") as () => ModelLike[];
    registry[ORIGINAL_REGISTRY_GET_AVAILABLE_KEY] = Reflect.get(
        registry,
        "getAvailable",
    ) as () => ModelLike[];
    registry[ORIGINAL_REGISTRY_FIND_KEY] = Reflect.get(registry, "find") as (
        provider: string,
        modelId: string,
    ) => ModelLike | undefined;

    registry.getAll = function getAll(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_REGISTRY_GET_ALL_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(
            this[REGISTRY_RUNTIME_KEY] ?? registry[REGISTRY_RUNTIME_KEY],
        );
        return filterModels(models, runtime.loadSettings());
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_REGISTRY_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(
            this[REGISTRY_RUNTIME_KEY] ?? registry[REGISTRY_RUNTIME_KEY],
        );
        return filterModels(models, runtime.loadSettings());
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_REGISTRY_FIND_KEY] ?? registry[ORIGINAL_REGISTRY_FIND_KEY];
        const model = finder?.call(this, provider, modelId);
        if (model === undefined) return undefined;

        const runtime = requireRegistryRuntime(
            this[REGISTRY_RUNTIME_KEY] ?? registry[REGISTRY_RUNTIME_KEY],
        );
        if (!isVisibleModel(model, runtime.loadSettings())) return undefined;
        return model;
    };

    registry[REGISTRY_PATCH_MARKER] = true;
}

export function installModelRuntimePatch(runtime: PatchedModelRuntime, state: RuntimeState): void {
    runtime[MODEL_RUNTIME_STATE_KEY] = state;

    if (
        typeof runtime.getModels !== "function" ||
        typeof runtime.getAvailable !== "function" ||
        typeof runtime.getAvailableSnapshot !== "function" ||
        typeof runtime.getModel !== "function"
    ) {
        throw new Error("Pi model runtime does not expose the expected methods.");
    }

    if (runtime[MODEL_RUNTIME_PATCH_MARKER] === true) return;

    runtime[ORIGINAL_RUNTIME_GET_MODELS_KEY] = Reflect.get(runtime, "getModels") as (
        providerId?: string,
    ) => readonly ModelLike[];
    runtime[ORIGINAL_RUNTIME_GET_AVAILABLE_KEY] = Reflect.get(runtime, "getAvailable") as (
        providerId?: string,
    ) => Promise<readonly ModelLike[]>;
    runtime[ORIGINAL_RUNTIME_GET_AVAILABLE_SNAPSHOT_KEY] = Reflect.get(
        runtime,
        "getAvailableSnapshot",
    ) as () => readonly ModelLike[];
    runtime[ORIGINAL_RUNTIME_GET_MODEL_KEY] = Reflect.get(runtime, "getModel") as (
        providerId: string,
        modelId: string,
    ) => ModelLike | undefined;

    runtime.getModels = function getModels(this: PatchedModelRuntime, providerId?: string) {
        const models = this[ORIGINAL_RUNTIME_GET_MODELS_KEY]?.call(this, providerId) ?? [];
        const state = requireRegistryRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        return filterModels(models, state.loadSettings());
    };

    runtime.getAvailable = async function getAvailable(
        this: PatchedModelRuntime,
        providerId?: string,
    ) {
        const models =
            (await this[ORIGINAL_RUNTIME_GET_AVAILABLE_KEY]?.call(this, providerId)) ?? [];
        const state = requireRegistryRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        return filterModels(models, state.loadSettings());
    };

    runtime.getAvailableSnapshot = function getAvailableSnapshot(this: PatchedModelRuntime) {
        const models = this[ORIGINAL_RUNTIME_GET_AVAILABLE_SNAPSHOT_KEY]?.call(this) ?? [];
        const state = requireRegistryRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        return filterModels(models, state.loadSettings());
    };

    runtime.getModel = function getModel(
        this: PatchedModelRuntime,
        providerId: string,
        modelId: string,
    ) {
        const finder =
            this[ORIGINAL_RUNTIME_GET_MODEL_KEY] ?? runtime[ORIGINAL_RUNTIME_GET_MODEL_KEY];
        const model = finder?.call(this, providerId, modelId);
        if (model === undefined) return undefined;

        const state = requireRegistryRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        if (!isVisibleModel(model, state.loadSettings())) return undefined;
        return model;
    };

    runtime[MODEL_RUNTIME_PATCH_MARKER] = true;
}

export default function providerModelFilterExtension(pi: ExtensionAPI) {
    const state: RuntimeState = {
        loadSettings: () => loadModelFilterSettings(state),
    };

    installModelRuntimePatch(ModelRuntime.prototype as PatchedModelRuntime, state);
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
