import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, visibleWidth } from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyProviderDisplayNames, getProviderAlias } from "./provider-aliasing.ts";
import type { LoadedConfig, ModelLike, RuntimeState } from "./types.ts";

const MODEL_SELECTOR_PROVIDER_PATCH_KEY = Symbol.for(
    "zigai.pi-model-alias.model-selector-provider-patched",
);
const MODEL_SELECTOR_PROVIDER_STATE_KEY = Symbol.for(
    "zigai.pi-model-alias.model-selector-provider-state",
);
const SCOPED_MODELS_PROVIDER_PATCH_KEY = Symbol.for(
    "zigai.pi-model-alias.scoped-models-provider-patched",
);
const SCOPED_MODELS_PROVIDER_STATE_KEY = Symbol.for(
    "zigai.pi-model-alias.scoped-models-provider-state",
);
const PROVIDER_GAP_EXTRA_WIDTH = 2;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const SEARCH_COUNTER_RENDER_PATCH_KEY = Symbol.for(
    "zigai.pi-model-alias.model-selector-search-counter-render-patched",
);

const searchCounterByInput = new WeakMap<object, string>();

type ModelSelectorItem = {
    provider: string;
    id: string;
    model: ModelLike;
};

type ListContainer = {
    children: unknown[];
};

type SearchInput = {
    [SEARCH_COUNTER_RENDER_PATCH_KEY]?: true;
    render(width: number): string[];
};

type RuntimeStateHolder = {
    state: RuntimeState;
};

type ModelSelectorPatchTarget = {
    [MODEL_SELECTOR_PROVIDER_PATCH_KEY]?: true;
    [MODEL_SELECTOR_PROVIDER_STATE_KEY]?: RuntimeStateHolder;
    loadModels(this: ModelSelectorPatchTarget): Promise<unknown>;
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
    [SCOPED_MODELS_PROVIDER_STATE_KEY]?: RuntimeStateHolder;
    buildItems?(this: ScopedModelsSelectorPatchTarget): ScopedModelsSelectorItem[];
    getFooterText?(this: ScopedModelsSelectorPatchTarget): string;
    refresh?(this: ScopedModelsSelectorPatchTarget): void;
    updateList(this: ScopedModelsSelectorPatchTarget): void;
    filteredItems: ScopedModelsSelectorItem[];
    footerText?: ScopedModelsFooterText;
    listContainer?: ListContainer;
    maxVisible?: number;
    searchInput?: ScopedModelsSearchInput & Partial<SearchInput>;
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

function setModelSelectorPatchState(
    target: ModelSelectorPatchTarget,
    state: RuntimeState,
): RuntimeStateHolder {
    const existingState = target[MODEL_SELECTOR_PROVIDER_STATE_KEY];
    if (existingState !== undefined) {
        existingState.state = state;
        return existingState;
    }

    const patchState: RuntimeStateHolder = { state };
    target[MODEL_SELECTOR_PROVIDER_STATE_KEY] = patchState;
    return patchState;
}

function setScopedModelsPatchState(
    target: ScopedModelsSelectorPatchTarget,
    state: RuntimeState,
): RuntimeStateHolder {
    const existingState = target[SCOPED_MODELS_PROVIDER_STATE_KEY];
    if (existingState !== undefined) {
        existingState.state = state;
        return existingState;
    }

    const patchState: RuntimeStateHolder = { state };
    target[SCOPED_MODELS_PROVIDER_STATE_KEY] = patchState;
    return patchState;
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

function getModelDisplayId(model: ModelLike): string {
    if (model.name === undefined || model.name.length === 0) {
        return model.id;
    }
    return model.name;
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

function getModelSelectorDisplayItems(items: ModelSelectorItem[]): ModelSelectorItem[] {
    return items.map((item) => {
        return {
            ...item,
            id: getModelDisplayId(item.model),
        };
    });
}

type ProviderRow = {
    readonly modelText: string;
    readonly providerText: string;
};

function textComponentValue(component: unknown): string | undefined {
    if (typeof component !== "object" || component === null) {
        return undefined;
    }

    const value = Reflect.get(component, "text");
    if (typeof value === "string") {
        return value;
    }
    return undefined;
}

function setTextComponentValue(component: unknown, text: string): void {
    if (typeof component !== "object" || component === null) {
        return;
    }

    const setText = Reflect.get(component, "setText");
    if (typeof setText === "function") {
        setText.call(component, text);
    }
}

function stripAnsi(text: string): string {
    return text.replace(ANSI_PATTERN, "");
}

function visibleRows<Item>(items: Item[], selectedIndex: number, maxVisible: number): Item[] {
    const startIndex = Math.max(
        0,
        Math.min(selectedIndex - Math.floor(maxVisible / 2), items.length - maxVisible),
    );
    const endIndex = Math.min(startIndex + maxVisible, items.length);
    return items.slice(startIndex, endIndex);
}

function removeModelNameDetail(container: ListContainer): void {
    const last = container.children.at(-1);
    const lastText = textComponentValue(last);
    if (lastText === undefined || !lastText.includes("Model Name:")) {
        return;
    }

    container.children.pop();
    container.children.pop();
}

function takeScrollCounter(container: ListContainer): string | undefined {
    const scrollIndex = container.children.findIndex((child) => {
        const text = textComponentValue(child);
        return text !== undefined && /\(\d+\/\d+\)/.test(text);
    });
    if (scrollIndex === -1) {
        return undefined;
    }

    const text = textComponentValue(container.children[scrollIndex]);
    container.children.splice(scrollIndex, 1);
    return text;
}

function setSearchCounter(
    input: Partial<SearchInput> | undefined,
    counter: string | undefined,
): void {
    if (input === undefined || typeof input.render !== "function") {
        return;
    }

    if (counter === undefined) {
        searchCounterByInput.delete(input);
    } else {
        searchCounterByInput.set(input, counter.trim());
    }

    if (input[SEARCH_COUNTER_RENDER_PATCH_KEY] === true) {
        return;
    }

    const originalRender = input.render;
    input.render = function renderWithSearchCounter(this: SearchInput, width: number): string[] {
        const lines = originalRender.call(this, width);
        const counterText = searchCounterByInput.get(this);
        const firstLine = lines[0];
        if (counterText === undefined || firstLine === undefined) {
            return lines;
        }

        const baseLine = firstLine.replace(/ +$/, "");
        const gap = width - visibleWidth(baseLine) - visibleWidth(counterText);
        if (gap < 1) {
            return lines;
        }

        return [`${baseLine}${" ".repeat(gap)}${counterText}`, ...lines.slice(1)];
    };
    input[SEARCH_COUNTER_RENDER_PATCH_KEY] = true;
}

function formatProviderRows(
    container: ListContainer,
    rows: readonly ProviderRow[],
    widthRows: readonly ProviderRow[] = rows,
): string | undefined {
    if (rows.length === 0) {
        const counter = takeScrollCounter(container);
        removeModelNameDetail(container);
        return counter;
    }

    let modelWidth = Math.max(...rows.map((row) => visibleWidth(row.modelText)));
    if (widthRows.length > 0) {
        modelWidth = Math.max(...widthRows.map((row) => visibleWidth(row.modelText)));
    }
    rows.forEach((row, index) => {
        const component = container.children[index];
        const text = textComponentValue(component);
        if (text === undefined) {
            return;
        }

        const badge = `[${row.providerText}]`;
        const badgeIndex = text.lastIndexOf(badge);
        if (badgeIndex === -1) {
            return;
        }

        const suffix = text.slice(badgeIndex + badge.length);
        let checkmark = "";
        if (stripAnsi(suffix).trim() === "✓") {
            checkmark = suffix;
        }
        const padding = " ".repeat(
            Math.max(0, modelWidth - visibleWidth(row.modelText) - visibleWidth(checkmark)) +
                PROVIDER_GAP_EXTRA_WIDTH,
        );
        const modelPrefix = text.slice(0, badgeIndex).trimEnd();
        const formatted = `${modelPrefix}${checkmark}${padding}${row.providerText}`;
        setTextComponentValue(component, formatted);
    });

    const counter = takeScrollCounter(container);
    removeModelNameDetail(container);
    return counter;
}

function getProviderRows(items: readonly ModelSelectorItem[]): ProviderRow[] {
    return items.map((item) => {
        return {
            modelText: item.id,
            providerText: item.provider,
        };
    });
}

function formatModelSelectorList(target: ModelSelectorPatchTarget, state: RuntimeState): void {
    const container = target.listContainer;
    if (container === undefined) {
        return;
    }

    const loaded = state.loadConfig();
    const rows = getProviderRows(visibleRows(target.filteredModels, target.selectedIndex, 10));
    let widthRows = rows;
    if (loaded.stableProviderColumn) {
        widthRows = getProviderRows(target.filteredModels);
    }
    const counter = formatProviderRows(container, rows, widthRows);
    setSearchCounter(target.searchInput, counter);
}

function getScopedProviderRows(items: readonly ScopedModelsSelectorItem[]): ProviderRow[] {
    return items.map((item) => {
        return {
            modelText: item.model.id,
            providerText: item.model.provider,
        };
    });
}

function formatScopedModelsList(
    target: ScopedModelsSelectorPatchTarget,
    state: RuntimeState,
): void {
    const container = target.listContainer;
    const selectedIndex = target.selectedIndex;
    if (container === undefined || selectedIndex === undefined) {
        return;
    }

    const loaded = state.loadConfig();
    const maxVisible = target.maxVisible ?? 8;
    const rows = getScopedProviderRows(
        visibleRows(target.filteredItems, selectedIndex, maxVisible),
    );
    let widthRows = rows;
    if (loaded.stableProviderColumn) {
        widthRows = getScopedProviderRows(target.filteredItems);
    }
    const counter = formatProviderRows(container, rows, widthRows);
    setSearchCounter(target.searchInput, counter);
}

function getScopedDisplayItems(
    items: ScopedModelsSelectorItem[],
    state: RuntimeState,
): ScopedModelsSelectorItem[] {
    const loaded = state.loadConfig();
    return items.map((item) => {
        const displayedModel: ModelLike = {
            ...item.model,
            id: getModelDisplayId(item.model),
        };
        const alias = getProviderAlias(item.model.provider, loaded);
        if (loaded.error === undefined && alias !== undefined) {
            displayedModel.provider = alias.name;
        }

        return {
            ...item,
            model: displayedModel,
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
    const patchState = setModelSelectorPatchState(prototype, state);
    if (prototype[MODEL_SELECTOR_PROVIDER_PATCH_KEY] === true) {
        return;
    }

    const originalLoadModelsValue: unknown = Reflect.get(prototype, "loadModels");
    const originalFilterModelsValue: unknown = Reflect.get(prototype, "filterModels");
    const originalUpdateListValue: unknown = Reflect.get(prototype, "updateList");
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
    if (typeof originalUpdateListValue !== "function") {
        warnProviderDisplayPatchUnavailable(
            "model picker provider alias patch",
            "missing updateList",
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
    const originalUpdateList = originalUpdateListValue as (this: ModelSelectorPatchTarget) => void;

    prototype.loadModels = async function loadModelsWithProviderAliases(
        this: ModelSelectorPatchTarget,
    ): Promise<unknown> {
        const result = await originalLoadModels.call(this);
        setModelSelectorDisplayProviders(this, patchState.state);
        return result;
    };

    prototype.filterModels = function filterModelsWithProviderAliases(
        this: ModelSelectorPatchTarget,
        query: string,
    ): void {
        const originalActiveModels = this.activeModels;
        this.activeModels = getModelSelectorSearchItems(originalActiveModels, patchState.state);
        try {
            originalFilterModels.call(this, query);
        } finally {
            this.activeModels = originalActiveModels;
        }
        const loaded = patchState.state.loadConfig();
        this.filteredModels = applyProviderDisplayNames(this.filteredModels, loaded);
        this.updateList();
    };

    prototype.updateList = function updateListWithModelNames(this: ModelSelectorPatchTarget): void {
        const originalFilteredModels = this.filteredModels;
        this.filteredModels = getModelSelectorDisplayItems(originalFilteredModels);
        try {
            originalUpdateList.call(this);
            formatModelSelectorList(this, patchState.state);
        } finally {
            this.filteredModels = originalFilteredModels;
        }
    };

    prototype[MODEL_SELECTOR_PROVIDER_PATCH_KEY] = true;
}

export function installScopedModelsProviderPatch(
    state: RuntimeState,
    prototype: ScopedModelsSelectorPatchTarget,
): void {
    const patchState = setScopedModelsPatchState(prototype, state);
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
        this.filteredItems = getScopedDisplayItems(originalFilteredItems, patchState.state);
        try {
            originalUpdateList.call(this);
            formatScopedModelsList(this, patchState.state);
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
            const loaded = patchState.state.loadConfig();
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
