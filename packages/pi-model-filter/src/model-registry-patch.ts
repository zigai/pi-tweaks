import { filterModels, isVisibleModel, type ModelLike } from "./model-filter.ts";
import type { LoadedModelFilterSettings } from "./settings.ts";

const REGISTRY_PATCH_MARKER = Symbol.for("@zigai/pi-model-filter/registry-patched");
const REGISTRY_RUNTIME_KEY = Symbol.for("@zigai/pi-model-filter/registry-runtime");
const ORIGINAL_REGISTRY_GET_ALL_KEY = Symbol.for("@zigai/pi-model-filter/registry-get-all");
const ORIGINAL_REGISTRY_GET_AVAILABLE_KEY = Symbol.for(
    "@zigai/pi-model-filter/registry-get-available",
);
const ORIGINAL_REGISTRY_FIND_KEY = Symbol.for("@zigai/pi-model-filter/registry-find");

export type ModelFilterRuntimeState = {
    loadSettings: () => LoadedModelFilterSettings;
    reportedDiagnosticKey?: string;
};

export type BasicModelRegistry = {
    getAll(): ModelLike[];
    getAvailable(): ModelLike[];
    find(provider: string, modelId: string): ModelLike | undefined;
};

export type PatchedModelRegistry = BasicModelRegistry & {
    [REGISTRY_PATCH_MARKER]?: boolean;
    [REGISTRY_RUNTIME_KEY]?: ModelFilterRuntimeState;
    [ORIGINAL_REGISTRY_GET_ALL_KEY]?: () => ModelLike[];
    [ORIGINAL_REGISTRY_GET_AVAILABLE_KEY]?: () => ModelLike[];
    [ORIGINAL_REGISTRY_FIND_KEY]?: (provider: string, modelId: string) => ModelLike | undefined;
};

export function requireModelFilterRuntime(
    runtime: ModelFilterRuntimeState | undefined,
): ModelFilterRuntimeState {
    if (runtime !== undefined) return runtime;
    throw new Error("Pi model filter runtime is not initialized.");
}

export function installRegistryPatch(
    registry: PatchedModelRegistry,
    state: ModelFilterRuntimeState,
): void {
    registry[REGISTRY_RUNTIME_KEY] = state;

    if (
        typeof registry.getAll !== "function" ||
        typeof registry.getAvailable !== "function" ||
        typeof registry.find !== "function"
    ) {
        throw new Error("Pi model registry does not expose the expected methods.");
    }

    if (registry[REGISTRY_PATCH_MARKER] === true) return;

    registry[ORIGINAL_REGISTRY_GET_ALL_KEY] = registry["getAll"];
    registry[ORIGINAL_REGISTRY_GET_AVAILABLE_KEY] = registry["getAvailable"];
    registry[ORIGINAL_REGISTRY_FIND_KEY] = registry["find"];

    registry.getAll = function getAll(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_REGISTRY_GET_ALL_KEY]?.call(this) ?? [];
        const runtime = requireModelFilterRuntime(
            this[REGISTRY_RUNTIME_KEY] ?? registry[REGISTRY_RUNTIME_KEY],
        );
        return filterModels(models, runtime.loadSettings().settings);
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_REGISTRY_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = requireModelFilterRuntime(
            this[REGISTRY_RUNTIME_KEY] ?? registry[REGISTRY_RUNTIME_KEY],
        );
        return filterModels(models, runtime.loadSettings().settings);
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_REGISTRY_FIND_KEY] ?? registry[ORIGINAL_REGISTRY_FIND_KEY];
        const model = finder?.call(this, provider, modelId);
        if (model === undefined) return undefined;

        const runtime = requireModelFilterRuntime(
            this[REGISTRY_RUNTIME_KEY] ?? registry[REGISTRY_RUNTIME_KEY],
        );
        if (!isVisibleModel(model, runtime.loadSettings().settings)) return undefined;
        return model;
    };

    registry[REGISTRY_PATCH_MARKER] = true;
}
