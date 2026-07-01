import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyProviderDisplayNames, getProviderAlias } from "./provider-aliasing.ts";
import type { LoadedConfig, ModelLike, RuntimeState } from "./types.ts";

const MODEL_SELECTOR_PROVIDER_PATCH_KEY = Symbol.for(
    "zigai.pi-model-alias.model-selector-provider-patched",
);
const SCOPED_MODELS_PROVIDER_PATCH_KEY = Symbol.for(
    "zigai.pi-model-alias.scoped-models-provider-patched",
);

type ModelSelectorItem = {
    provider: string;
    id: string;
    model: ModelLike;
};

type ModelSelectorPatchTarget = {
    [MODEL_SELECTOR_PROVIDER_PATCH_KEY]?: true;
    loadModels(this: ModelSelectorPatchTarget): Promise<unknown>;
    filterModels(this: ModelSelectorPatchTarget, query: string): void;
    updateList(this: ModelSelectorPatchTarget): void;
    allModels: ModelSelectorItem[];
    scopedModelItems: ModelSelectorItem[];
    activeModels: ModelSelectorItem[];
    filteredModels: ModelSelectorItem[];
    scope: string;
};

type ScopedModelsSelectorItem = {
    fullId: string;
    model: ModelLike;
    enabled: boolean;
};

type ScopedModelsSearchInput = {
    getValue(): string;
};

type ScopedModelsFooterText = {
    setText(text: string): void;
};

type ScopedModelsSelectorPatchTarget = {
    [SCOPED_MODELS_PROVIDER_PATCH_KEY]?: true;
    buildItems?(this: ScopedModelsSelectorPatchTarget): ScopedModelsSelectorItem[];
    getFooterText?(this: ScopedModelsSelectorPatchTarget): string;
    refresh?(this: ScopedModelsSelectorPatchTarget): void;
    updateList(this: ScopedModelsSelectorPatchTarget): void;
    filteredItems: ScopedModelsSelectorItem[];
    footerText?: ScopedModelsFooterText;
    searchInput?: ScopedModelsSearchInput;
    selectedIndex?: number;
};

type ScopedModelsSelectorModule = {
    ScopedModelsSelectorComponent?: {
        prototype?: unknown;
    };
};

function warnProviderDisplayPatchUnavailable(feature: string, error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(`[pi-model-alias] ${feature} unavailable; Pi internals may have changed${suffix}`);
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

function isScopedModelsSelectorPatchTarget(
    value: unknown,
): value is ScopedModelsSelectorPatchTarget {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return typeof Reflect.get(value, "updateList") === "function";
}

function setModelSelectorDisplayProviders(
    target: ModelSelectorPatchTarget,
    state: RuntimeState,
): void {
    const loaded = state.loadConfig();
    target.allModels = applyProviderDisplayNames(target.allModels, loaded);
    target.scopedModelItems = applyProviderDisplayNames(target.scopedModelItems, loaded);

    let activeModels = target.allModels;
    if (target.scope === "scoped") {
        activeModels = target.scopedModelItems;
    }
    target.activeModels = activeModels;
    target.filteredModels = activeModels;
}

function getModelSelectorSearchItems(
    items: ModelSelectorItem[],
    state: RuntimeState,
): ModelSelectorItem[] {
    const loaded = state.loadConfig();
    if (loaded.error !== undefined || loaded.providerAliases.length === 0) {
        return items;
    }

    return items.map((item) => {
        const alias = getProviderAlias(item.model.provider, loaded);
        if (alias === undefined) {
            return item;
        }

        return {
            ...item,
            provider: `${alias.name} ${item.model.provider}`,
        };
    });
}

function getScopedDisplayItems(
    items: ScopedModelsSelectorItem[],
    state: RuntimeState,
): ScopedModelsSelectorItem[] {
    const loaded = state.loadConfig();
    if (loaded.error !== undefined || loaded.providerAliases.length === 0) {
        return items;
    }

    return items.map((item) => {
        const alias = getProviderAlias(item.model.provider, loaded);
        if (alias === undefined) {
            return item;
        }

        return {
            ...item,
            model: {
                ...item.model,
                provider: alias.name,
            },
        };
    });
}

function getScopedSearchText(item: ScopedModelsSelectorItem, loaded: LoadedConfig): string {
    const model = item.model;
    const alias = getProviderAlias(model.provider, loaded);
    let provider = model.provider;
    if (alias !== undefined) {
        provider = `${alias.name} ${model.provider}`;
    }
    let name = "";
    if (model.name !== undefined && model.name.length > 0) {
        name = ` ${model.name}`;
    }
    return `${model.id} ${provider} ${provider}/${model.id} ${provider} ${model.id}${name}`;
}

export function installModelSelectorProviderPatch(
    state: RuntimeState,
    prototype: ModelSelectorPatchTarget = ModelSelectorComponent.prototype as unknown as ModelSelectorPatchTarget,
): void {
    if (prototype[MODEL_SELECTOR_PROVIDER_PATCH_KEY] === true) {
        return;
    }

    const originalLoadModelsValue: unknown = Reflect.get(prototype, "loadModels");
    const originalFilterModelsValue: unknown = Reflect.get(prototype, "filterModels");
    if (typeof originalLoadModelsValue !== "function") {
        warnProviderDisplayPatchUnavailable(
            "model picker provider alias patch",
            "missing loadModels",
        );
        return;
    }
    if (typeof originalFilterModelsValue !== "function") {
        warnProviderDisplayPatchUnavailable(
            "model picker provider alias patch",
            "missing filterModels",
        );
        return;
    }

    // SAFETY: Runtime guards above verify ModelSelectorComponent exposes the
    // methods this patch wraps.
    const originalLoadModels = originalLoadModelsValue as (
        this: ModelSelectorPatchTarget,
    ) => Promise<unknown>;
    const originalFilterModels = originalFilterModelsValue as (
        this: ModelSelectorPatchTarget,
        query: string,
    ) => void;

    prototype.loadModels = async function loadModelsWithProviderAliases(
        this: ModelSelectorPatchTarget,
    ): Promise<unknown> {
        const result = await originalLoadModels.call(this);
        setModelSelectorDisplayProviders(this, state);
        return result;
    };

    prototype.filterModels = function filterModelsWithProviderAliases(
        this: ModelSelectorPatchTarget,
        query: string,
    ): void {
        const originalActiveModels = this.activeModels;
        this.activeModels = getModelSelectorSearchItems(originalActiveModels, state);
        try {
            originalFilterModels.call(this, query);
        } finally {
            this.activeModels = originalActiveModels;
        }
        const loaded = state.loadConfig();
        this.filteredModels = applyProviderDisplayNames(this.filteredModels, loaded);
        this.updateList();
    };

    prototype[MODEL_SELECTOR_PROVIDER_PATCH_KEY] = true;
}

export function installScopedModelsProviderPatch(
    state: RuntimeState,
    prototype: ScopedModelsSelectorPatchTarget,
): void {
    if (prototype[SCOPED_MODELS_PROVIDER_PATCH_KEY] === true) {
        return;
    }

    const originalUpdateListValue: unknown = Reflect.get(prototype, "updateList");
    const originalRefreshValue: unknown = Reflect.get(prototype, "refresh");
    const originalBuildItemsValue: unknown = Reflect.get(prototype, "buildItems");
    if (typeof originalUpdateListValue !== "function") {
        warnProviderDisplayPatchUnavailable(
            "scoped models provider alias patch",
            "missing updateList",
        );
        return;
    }

    // SAFETY: Runtime guard above verifies ScopedModelsSelectorComponent exposes
    // the updateList seam this display-only patch wraps.
    const originalUpdateList = originalUpdateListValue as (
        this: ScopedModelsSelectorPatchTarget,
    ) => void;

    prototype.updateList = function updateListWithProviderAliases(
        this: ScopedModelsSelectorPatchTarget,
    ): void {
        const originalFilteredItems = this.filteredItems;
        this.filteredItems = getScopedDisplayItems(originalFilteredItems, state);
        try {
            originalUpdateList.call(this);
        } finally {
            this.filteredItems = originalFilteredItems;
        }
    };

    if (
        typeof originalRefreshValue === "function" &&
        typeof originalBuildItemsValue === "function"
    ) {
        const originalRefresh = originalRefreshValue as (
            this: ScopedModelsSelectorPatchTarget,
        ) => void;
        const originalBuildItems = originalBuildItemsValue as (
            this: ScopedModelsSelectorPatchTarget,
        ) => ScopedModelsSelectorItem[];

        prototype.refresh = function refreshWithProviderAliasSearch(
            this: ScopedModelsSelectorPatchTarget,
        ): void {
            const query = this.searchInput?.getValue();
            const loaded = state.loadConfig();
            if (query === undefined || query.length === 0 || loaded.error !== undefined) {
                originalRefresh.call(this);
                return;
            }
            if (loaded.providerAliases.length === 0) {
                originalRefresh.call(this);
                return;
            }

            const items = originalBuildItems.call(this);
            this.filteredItems = fuzzyFilter(items, query, (item) =>
                getScopedSearchText(item, loaded),
            );
            if (this.selectedIndex !== undefined) {
                this.selectedIndex = Math.min(
                    this.selectedIndex,
                    Math.max(0, this.filteredItems.length - 1),
                );
            }
            this.updateList();
            const footerText = this.getFooterText?.();
            if (footerText !== undefined) {
                this.footerText?.setText(footerText);
            }
        };
    }

    prototype[SCOPED_MODELS_PROVIDER_PATCH_KEY] = true;
}

async function installScopedModelsProviderPatchFromPi(state: RuntimeState): Promise<void> {
    try {
        const distDir = await resolvePiDistDir();
        const componentPath = pathToFileURL(
            join(distDir, "modes/interactive/components/scoped-models-selector.js"),
        ).href;
        const componentModule = (await import(componentPath)) as ScopedModelsSelectorModule;
        const prototype = componentModule.ScopedModelsSelectorComponent?.prototype;
        if (!isScopedModelsSelectorPatchTarget(prototype)) {
            warnProviderDisplayPatchUnavailable("scoped models provider alias patch");
            return;
        }
        installScopedModelsProviderPatch(state, prototype);
    } catch (error: unknown) {
        warnProviderDisplayPatchUnavailable("scoped models provider alias patch", error);
    }
}

export function installProviderAliasUiPatches(state: RuntimeState): void {
    installModelSelectorProviderPatch(state);
    void installScopedModelsProviderPatchFromPi(state);
}
