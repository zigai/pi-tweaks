import { filterModels, isVisibleModel, type ModelLike } from "./model-filter.ts";
import { requireModelFilterRuntime, type ModelFilterRuntimeState } from "./model-registry-patch.ts";

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

export type BasicModelRuntime = {
    getModels(providerId?: string): readonly ModelLike[];
    getAvailable(providerId?: string): Promise<readonly ModelLike[]>;
    getAvailableSnapshot(): readonly ModelLike[];
    getModel(providerId: string, modelId: string): ModelLike | undefined;
};

export type PatchedModelRuntime = BasicModelRuntime & {
    [MODEL_RUNTIME_PATCH_MARKER]?: boolean;
    [MODEL_RUNTIME_STATE_KEY]?: ModelFilterRuntimeState;
    [ORIGINAL_RUNTIME_GET_MODELS_KEY]?: (providerId?: string) => readonly ModelLike[];
    [ORIGINAL_RUNTIME_GET_AVAILABLE_KEY]?: (providerId?: string) => Promise<readonly ModelLike[]>;
    [ORIGINAL_RUNTIME_GET_AVAILABLE_SNAPSHOT_KEY]?: () => readonly ModelLike[];
    [ORIGINAL_RUNTIME_GET_MODEL_KEY]?: (
        providerId: string,
        modelId: string,
    ) => ModelLike | undefined;
};

export function installModelRuntimePatch(
    runtime: PatchedModelRuntime,
    state: ModelFilterRuntimeState,
): void {
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

    runtime[ORIGINAL_RUNTIME_GET_MODELS_KEY] = runtime["getModels"];
    runtime[ORIGINAL_RUNTIME_GET_AVAILABLE_KEY] = runtime["getAvailable"];
    runtime[ORIGINAL_RUNTIME_GET_AVAILABLE_SNAPSHOT_KEY] = runtime["getAvailableSnapshot"];
    runtime[ORIGINAL_RUNTIME_GET_MODEL_KEY] = runtime["getModel"];

    runtime.getModels = function getModels(this: PatchedModelRuntime, providerId?: string) {
        const models = this[ORIGINAL_RUNTIME_GET_MODELS_KEY]?.call(this, providerId) ?? [];
        const filterState = requireModelFilterRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        return filterModels(models, filterState.loadSettings().settings);
    };

    runtime.getAvailable = async function getAvailable(
        this: PatchedModelRuntime,
        providerId?: string,
    ) {
        const models =
            (await this[ORIGINAL_RUNTIME_GET_AVAILABLE_KEY]?.call(this, providerId)) ?? [];
        const filterState = requireModelFilterRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        return filterModels(models, filterState.loadSettings().settings);
    };

    runtime.getAvailableSnapshot = function getAvailableSnapshot(this: PatchedModelRuntime) {
        const models = this[ORIGINAL_RUNTIME_GET_AVAILABLE_SNAPSHOT_KEY]?.call(this) ?? [];
        const filterState = requireModelFilterRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        return filterModels(models, filterState.loadSettings().settings);
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

        const filterState = requireModelFilterRuntime(
            this[MODEL_RUNTIME_STATE_KEY] ?? runtime[MODEL_RUNTIME_STATE_KEY],
        );
        if (!isVisibleModel(model, filterState.loadSettings().settings)) return undefined;
        return model;
    };

    runtime[MODEL_RUNTIME_PATCH_MARKER] = true;
}
