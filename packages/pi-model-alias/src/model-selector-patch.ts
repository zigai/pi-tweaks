import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { installLinkedMethodPatch } from "@zigai/pi-extension-internals";

import { warnProviderDisplayPatchUnavailable } from "./internal-imports.ts";
import {
    getAliasForModel,
    getAliasModelIdCollision,
    type ModelAliasSettings,
    type ModelLike,
} from "./model-aliasing.ts";
import { applyProviderDisplayNames, getProviderAlias } from "./provider-aliasing.ts";
import {
    formatProviderRows,
    setSearchCounter,
    visibleRows,
    type ListContainer,
    type ProviderRow,
    type SearchInput,
} from "./provider-row.ts";
import type { ModelAliasRuntimeState } from "./registry-patch.ts";
import { installScopedModelsProviderPatchFromPi } from "./scoped-model-selector-patch.ts";

const MODEL_SELECTOR_PROVIDER_PATCH_KEY = Symbol.for(
    "zigai.pi-model-alias.model-selector-provider-patched",
);
const MODEL_SELECTOR_PROVIDER_STATE_KEY = Symbol.for(
    "zigai.pi-model-alias.model-selector-provider-state",
);

type ModelSelectorItem = {
    provider: string;
    id: string;
    model: ModelLike;
};

type RuntimeStateHolder = { state: ModelAliasRuntimeState };

export type ModelSelectorPatchTarget = {
    [MODEL_SELECTOR_PROVIDER_PATCH_KEY]?: true;
    [MODEL_SELECTOR_PROVIDER_STATE_KEY]?: RuntimeStateHolder;
    loadModelsFromSnapshot(this: ModelSelectorPatchTarget): void;
    filterModels(this: ModelSelectorPatchTarget, query: string): void;
    updateList(this: ModelSelectorPatchTarget): void;
    allModels: ModelSelectorItem[];
    scopedModelItems: ModelSelectorItem[];
    activeModels: ModelSelectorItem[];
    filteredModels: ModelSelectorItem[];
    listContainer?: ListContainer;
    searchInput?: SearchInput;
    selectedIndex: number;
    scope: string;
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function isModelSelectorPatchTarget(value: unknown): value is ModelSelectorPatchTarget {
    return (
        ((typeof value === "object" && value !== null) || typeof value === "function") &&
        typeof getUnknownProperty(value, "loadModelsFromSnapshot") === "function" &&
        typeof getUnknownProperty(value, "filterModels") === "function" &&
        typeof getUnknownProperty(value, "updateList") === "function"
    );
}

function setPatchState(
    target: ModelSelectorPatchTarget,
    state: ModelAliasRuntimeState,
): RuntimeStateHolder {
    const existingState = target[MODEL_SELECTOR_PROVIDER_STATE_KEY];
    if (existingState !== undefined) {
        existingState.state = state;
        return existingState;
    }
    const patchState = { state };
    target[MODEL_SELECTOR_PROVIDER_STATE_KEY] = patchState;
    return patchState;
}

function getSettings(
    target: ModelSelectorPatchTarget,
    state: ModelAliasRuntimeState,
): ModelAliasSettings {
    const loaded = state.loadSettings();
    if (loaded.diagnostic !== undefined) return loaded.settings;
    const nativeModels = target.allModels.map((item) => item.model);
    if (getAliasModelIdCollision(loaded.settings, nativeModels) === undefined) {
        return loaded.settings;
    }
    return { ...loaded.settings, aliases: [], providerAliases: [] };
}

function applyModelSelectorAliases(
    items: readonly ModelSelectorItem[],
    settings: ModelAliasSettings,
): ModelSelectorItem[] {
    const modelAliased = items.map((item) => {
        const alias = getAliasForModel(item.model, settings);
        if (alias === undefined) return item;
        return { ...item, id: alias.alias };
    });
    return applyProviderDisplayNames(modelAliased, settings);
}

function setModelSelectorAliases(
    target: ModelSelectorPatchTarget,
    state: ModelAliasRuntimeState,
): void {
    const settings = getSettings(target, state);
    target.allModels = applyModelSelectorAliases(target.allModels, settings);
    target.scopedModelItems = applyModelSelectorAliases(target.scopedModelItems, settings);
    if (target.scope === "scoped") {
        target.activeModels = target.scopedModelItems;
    } else {
        target.activeModels = target.allModels;
    }
    target.filteredModels = target.activeModels;
}

function getModelDisplayId(model: ModelLike, settings: ModelAliasSettings): string {
    const alias = getAliasForModel(model, settings);
    if (alias?.name !== undefined && alias.name.length > 0) return alias.name;
    if (model.name !== undefined && model.name.length > 0) return model.name;
    return alias?.alias ?? model.id;
}

function getSearchItems(
    target: ModelSelectorPatchTarget,
    state: ModelAliasRuntimeState,
): {
    readonly items: ModelSelectorItem[];
    readonly originals: ReadonlyMap<ModelSelectorItem, ModelSelectorItem>;
} {
    const items = target.activeModels;
    const settings = getSettings(target, state);
    if (settings.providerAliases.length === 0 && settings.aliases.length === 0) {
        return { items, originals: new Map() };
    }

    const originals = new Map<ModelSelectorItem, ModelSelectorItem>();
    const searchItems = items.map((item) => {
        const providerAlias = getProviderAlias(item.model.provider, settings);
        const modelAlias = getAliasForModel(item.model, settings);
        if (providerAlias === undefined && modelAlias === undefined) return item;

        let provider = item.provider;
        if (providerAlias !== undefined) {
            provider = `${providerAlias.name} ${item.model.provider}`;
        }
        const modelSearchTerms = [item.model.name, modelAlias?.name, item.model.id]
            .filter((term): term is string => term !== undefined && term.length > 0)
            .join(" ");
        const searchItem = { ...item, provider, model: { ...item.model, name: modelSearchTerms } };
        originals.set(searchItem, item);
        return searchItem;
    });
    return { items: searchItems, originals };
}

function formatModelSelectorList(
    target: ModelSelectorPatchTarget,
    state: ModelAliasRuntimeState,
): void {
    const container = target.listContainer;
    if (container === undefined) return;

    const settings = getSettings(target, state);
    const toRows = (items: readonly ModelSelectorItem[]): ProviderRow[] =>
        items.map((item) => ({
            modelText: getModelDisplayId(item.model, settings),
            providerText: item.provider,
        }));
    const rows = toRows(visibleRows(target.filteredModels, target.selectedIndex, 10));
    let widthRows = rows;
    if (settings.stableProviderColumn) widthRows = toRows(target.filteredModels);
    setSearchCounter(target.searchInput, formatProviderRows(container, rows, widthRows));
}

export function installModelSelectorProviderPatch(
    state: ModelAliasRuntimeState,
    prototype?: ModelSelectorPatchTarget,
): void {
    const target = prototype ?? ModelSelectorComponent.prototype;
    if (!isModelSelectorPatchTarget(target)) {
        warnProviderDisplayPatchUnavailable("model picker provider alias patch");
        return;
    }
    const patchState = setPatchState(target, state);
    if (target[MODEL_SELECTOR_PROVIDER_PATCH_KEY] === true) return;

    const originalLoadModelsFromSnapshot: unknown = Reflect.get(target, "loadModelsFromSnapshot");
    const originalFilterModels: unknown = Reflect.get(target, "filterModels");
    if (
        typeof originalLoadModelsFromSnapshot !== "function" ||
        typeof originalFilterModels !== "function"
    ) {
        warnProviderDisplayPatchUnavailable("model picker provider alias patch");
        return;
    }

    target.loadModelsFromSnapshot = function loadModelsFromSnapshotWithAliases(): void {
        Reflect.apply(originalLoadModelsFromSnapshot, this, []);
        setModelSelectorAliases(this, patchState.state);
    };

    target.filterModels = function filterModelsWithProviderAliases(query: string): void {
        const originalActiveModels = this.activeModels;
        const search = getSearchItems(this, patchState.state);
        this.activeModels = search.items;
        try {
            Reflect.apply(originalFilterModels, this, [query]);
        } finally {
            this.activeModels = originalActiveModels;
        }
        this.filteredModels = this.filteredModels.map((item) => search.originals.get(item) ?? item);
        this.updateList();
    };

    installLinkedMethodPatch(target, "updateList", (predecessor) => {
        return function updateListWithModelNames(this: ModelSelectorPatchTarget): void {
            const originalFilteredModels = this.filteredModels;
            const settings = getSettings(this, patchState.state);
            this.filteredModels = originalFilteredModels.map((item) => ({
                ...item,
                id: getModelDisplayId(item.model, settings),
            }));
            try {
                predecessor.call(this);
                formatModelSelectorList(this, patchState.state);
            } finally {
                this.filteredModels = originalFilteredModels;
            }
        };
    });

    target[MODEL_SELECTOR_PROVIDER_PATCH_KEY] = true;
}

export type ProviderAliasUiPatchOptions = {
    readonly modelSelectorPrototype?: ModelSelectorPatchTarget;
    readonly installScopedModelsProviderPatchFromPi?: (
        state: ModelAliasRuntimeState,
    ) => Promise<void>;
};

export async function installProviderAliasUiPatches(
    state: ModelAliasRuntimeState,
    options: ProviderAliasUiPatchOptions = {},
): Promise<void> {
    installModelSelectorProviderPatch(state, options.modelSelectorPrototype);
    const installScopedPatch =
        options.installScopedModelsProviderPatchFromPi ?? installScopedModelsProviderPatchFromPi;
    await installScopedPatch(state);
}
