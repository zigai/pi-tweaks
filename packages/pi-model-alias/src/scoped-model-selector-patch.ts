import { fuzzyFilter } from "@earendil-works/pi-tui";
import { installLinkedMethodPatch } from "@zigai/pi-extension-internals";

import {
    loadScopedModelsSelectorPrototype,
    type ScopedModelsSelectorPrototypeCandidate,
    warnProviderDisplayPatchUnavailable,
} from "./internal-imports.ts";
import {
    getAliasForModel,
    getAliasModelIdCollision,
    type ModelAliasSettings,
    type ModelLike,
} from "./model-aliasing.ts";
import { getProviderAlias } from "./provider-aliasing.ts";
import {
    formatProviderRows,
    setSearchCounter,
    visibleRows,
    type ListContainer,
    type ProviderRow,
    type SearchInput,
} from "./provider-row.ts";
import type { ModelAliasRuntimeState } from "./registry-patch.ts";

const SCOPED_MODELS_PROVIDER_PATCH_KEY = Symbol.for(
    "zigai.pi-model-alias.scoped-models-provider-patched",
);
const SCOPED_MODELS_PROVIDER_STATE_KEY = Symbol.for(
    "zigai.pi-model-alias.scoped-models-provider-state",
);

type ScopedModelsSelectorItem = {
    fullId: string;
    model: ModelLike;
    enabled: boolean;
};

type ScopedModelsSearchInput = { getValue(): string };
type ScopedModelsFooterText = { setText(text: string): void };
type RuntimeStateHolder = { state: ModelAliasRuntimeState };

export type ScopedModelsSelectorPatchTarget = {
    [SCOPED_MODELS_PROVIDER_PATCH_KEY]?: true;
    [SCOPED_MODELS_PROVIDER_STATE_KEY]?: RuntimeStateHolder;
    buildItems?: (this: ScopedModelsSelectorPatchTarget) => ScopedModelsSelectorItem[];
    getFooterText?: (this: ScopedModelsSelectorPatchTarget) => string;
    refresh?: (this: ScopedModelsSelectorPatchTarget) => void;
    updateList: (this: ScopedModelsSelectorPatchTarget) => void;
    filteredItems: ScopedModelsSelectorItem[];
    footerText?: ScopedModelsFooterText;
    listContainer?: ListContainer;
    maxVisible?: number;
    searchInput?: ScopedModelsSearchInput & Partial<SearchInput>;
    selectedIndex?: number;
};

function isScopedModelsSelectorPatchTarget(
    value: ScopedModelsSelectorPrototypeCandidate,
): value is ScopedModelsSelectorPatchTarget {
    return "updateList" in value && typeof value.updateList === "function";
}

function setPatchState(
    target: ScopedModelsSelectorPatchTarget,
    state: ModelAliasRuntimeState,
): RuntimeStateHolder {
    const existingState = target[SCOPED_MODELS_PROVIDER_STATE_KEY];
    if (existingState !== undefined) {
        existingState.state = state;
        return existingState;
    }
    const patchState = { state };
    target[SCOPED_MODELS_PROVIDER_STATE_KEY] = patchState;
    return patchState;
}

function getSettingsForModels(
    state: ModelAliasRuntimeState,
    models: readonly ModelLike[],
): ModelAliasSettings {
    const loaded = state.loadSettings();
    if (loaded.diagnostic !== undefined) return loaded.settings;
    if (getAliasModelIdCollision(loaded.settings, models) === undefined) return loaded.settings;
    return { ...loaded.settings, aliases: [], providerAliases: [] };
}

function getModelDisplayId(model: ModelLike, settings: ModelAliasSettings): string {
    const alias = getAliasForModel(model, settings);
    if (alias?.name !== undefined && alias.name.length > 0) return alias.name;
    if (model.name !== undefined && model.name.length > 0) return model.name;
    return alias?.alias ?? model.id;
}

function getDisplayItems(
    items: readonly ScopedModelsSelectorItem[],
    state: ModelAliasRuntimeState,
): ScopedModelsSelectorItem[] {
    const settings = getSettingsForModels(
        state,
        items.map((item) => item.model),
    );
    return items.map((item) => {
        const displayedModel = { ...item.model, id: getModelDisplayId(item.model, settings) };
        const alias = getProviderAlias(item.model.provider, settings);
        if (alias !== undefined) displayedModel.provider = alias.name;
        return { ...item, model: displayedModel };
    });
}

function getSearchText(item: ScopedModelsSelectorItem, settings: ModelAliasSettings): string {
    const model = item.model;
    const providerAlias = getProviderAlias(model.provider, settings);
    let provider = model.provider;
    if (providerAlias !== undefined) provider = `${providerAlias.name} ${model.provider}`;
    const modelAlias = getAliasForModel(model, settings);
    let ids = model.id;
    if (modelAlias !== undefined) ids = `${modelAlias.alias} ${model.id}`;
    const names = [model.name, modelAlias?.name]
        .filter((name): name is string => name !== undefined && name.length > 0)
        .join(" ");
    return `${ids} ${provider} ${provider}/${ids} ${provider} ${ids} ${names}`;
}

function formatList(target: ScopedModelsSelectorPatchTarget, state: ModelAliasRuntimeState): void {
    const container = target.listContainer;
    const selectedIndex = target.selectedIndex;
    if (container === undefined || selectedIndex === undefined) return;

    const settings = getSettingsForModels(
        state,
        target.filteredItems.map((item) => item.model),
    );
    const toRows = (items: readonly ScopedModelsSelectorItem[]): ProviderRow[] =>
        items.map((item) => ({
            modelText: getModelDisplayId(item.model, settings),
            providerText:
                getProviderAlias(item.model.provider, settings)?.name ?? item.model.provider,
        }));
    const rows = toRows(visibleRows(target.filteredItems, selectedIndex, target.maxVisible ?? 8));
    let widthRows = rows;
    if (settings.stableProviderColumn) widthRows = toRows(target.filteredItems);
    setSearchCounter(target.searchInput, formatProviderRows(container, rows, widthRows));
}

export function installScopedModelsProviderPatch(
    state: ModelAliasRuntimeState,
    prototype: ScopedModelsSelectorPatchTarget,
): void {
    if (typeof prototype.updateList !== "function") {
        warnProviderDisplayPatchUnavailable(
            "scoped models provider alias patch",
            new Error("missing updateList"),
        );
        return;
    }
    const patchState = setPatchState(prototype, state);
    if (prototype[SCOPED_MODELS_PROVIDER_PATCH_KEY] === true) return;

    const originalRefresh = prototype.refresh;
    const originalBuildItems = prototype.buildItems;

    installLinkedMethodPatch(prototype, "updateList", (predecessor) => {
        return function updateListWithProviderAliases(this: ScopedModelsSelectorPatchTarget): void {
            const originalFilteredItems = this.filteredItems;
            this.filteredItems = getDisplayItems(originalFilteredItems, patchState.state);
            try {
                predecessor.call(this);
                formatList(this, patchState.state);
            } finally {
                this.filteredItems = originalFilteredItems;
            }
        };
    });

    if (typeof originalRefresh === "function" && typeof originalBuildItems === "function") {
        prototype.refresh = function refreshWithProviderAliasSearch(): void {
            const query = this.searchInput?.getValue();
            const items = originalBuildItems.call(this);
            const settings = getSettingsForModels(
                patchState.state,
                items.map((item) => item.model),
            );
            if (
                query === undefined ||
                query.length === 0 ||
                (settings.providerAliases.length === 0 && settings.aliases.length === 0)
            ) {
                originalRefresh.call(this);
                return;
            }

            this.filteredItems = fuzzyFilter(items, query, (item) => getSearchText(item, settings));
            if (this.selectedIndex !== undefined) {
                this.selectedIndex = Math.min(
                    this.selectedIndex,
                    Math.max(0, this.filteredItems.length - 1),
                );
            }
            this.updateList();
            const footerText = this.getFooterText?.();
            if (footerText !== undefined) this.footerText?.setText(footerText);
        };
    }

    prototype[SCOPED_MODELS_PROVIDER_PATCH_KEY] = true;
}

export async function installScopedModelsProviderPatchFromPi(
    state: ModelAliasRuntimeState,
): Promise<void> {
    const prototype = await loadScopedModelsSelectorPrototype((value) => {
        if (isScopedModelsSelectorPatchTarget(value)) return value;
        return undefined;
    });
    if (prototype === undefined) return;
    installScopedModelsProviderPatch(state, prototype);
}
