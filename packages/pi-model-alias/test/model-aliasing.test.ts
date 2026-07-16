import assert from "node:assert/strict";
import { test } from "vitest";

import {
    aliasModels,
    applyAlias,
    getAliasForLookup,
    getAliasForModel,
    getAliasModelIdCollision,
} from "../src/model-aliasing.ts";
import { getProviderDisplayName } from "../src/provider-aliasing.ts";
import {
    installModelSelectorProviderPatch,
    installScopedModelsProviderPatch,
} from "../src/model-selector-provider-patch.ts";
import { aliasForProviderRequest, rewritePayloadModel } from "../src/provider-payload.ts";
import { installRegistryPatch, type PatchedModelRegistry } from "../src/registry-patch.ts";
import type {
    AliasConfig,
    LoadedConfig,
    ModelLike,
    ProviderAliasConfig,
    RuntimeState,
} from "../src/types.ts";

function loadedConfig(
    aliases: AliasConfig[],
    error?: string,
    providerAliases: ProviderAliasConfig[] = [],
    stableProviderColumn = true,
): LoadedConfig {
    const loaded: LoadedConfig = {
        path: "model-aliases.json",
        mtimeMs: 1,
        aliases,
        providerAliases,
        stableProviderColumn,
    };
    if (error !== undefined) {
        loaded.error = error;
    }
    return loaded;
}

const nativeModels: ModelLike[] = [
    { provider: "openai", id: "gpt-5", name: "GPT-5" },
    { provider: "anthropic", id: "claude-opus", name: "Claude Opus" },
];

const aliases: AliasConfig[] = [
    { provider: "openai", model: "gpt-5", alias: "fast", name: "Fast" },
    { provider: "anthropic", model: "claude-opus", alias: "smart" },
];

type TestTextComponent = {
    text: string;
    setText(text: string): void;
};

function textComponent(text: string): TestTextComponent {
    return {
        text,
        setText(nextText: string) {
            this.text = nextText;
        },
    };
}

function textValues(children: unknown[]): string[] {
    return children.flatMap((child) => {
        if (typeof child !== "object" || child === null) {
            return [];
        }
        const text: unknown = Reflect.get(child, "text") as unknown;
        if (typeof text !== "string") {
            return [];
        }
        return [text];
    });
}

test("aliases models without mutating unrelated models", () => {
    const loaded = loadedConfig(aliases);
    const aliased = aliasModels(nativeModels, loaded);

    assert.deepEqual(aliased, [
        { provider: "openai", id: "fast", name: "Fast" },
        { provider: "anthropic", id: "smart", name: "Claude Opus" },
    ]);
    assert.equal(nativeModels[0]?.id, "gpt-5");
});

test("does not apply aliases when config has a load error", () => {
    const loaded = loadedConfig(aliases, "invalid config");

    assert.deepEqual(aliasModels(nativeModels, loaded), nativeModels);
});

test("resolves provider display aliases without changing provider ids", () => {
    const loaded = loadedConfig([], undefined, [{ provider: "openai", name: "OpenAI Work" }]);

    assert.equal(getProviderDisplayName("openai", "OpenAI", loaded), "OpenAI Work");
    assert.equal(getProviderDisplayName("anthropic", "Anthropic", loaded), "Anthropic");
});

test("detects alias collisions with native model ids per provider", () => {
    const collision = getAliasModelIdCollision(
        [{ provider: "openai", model: "gpt-5", alias: "gpt-5" }],
        nativeModels,
    );

    assert.match(collision ?? "", /conflicts with an existing model id/);

    const crossProviderCollision = getAliasModelIdCollision(
        [{ provider: "anthropic", model: "claude-opus", alias: "gpt-5" }],
        nativeModels,
    );
    assert.equal(crossProviderCollision, undefined);
});

test("finds aliases by model and by provider lookup", () => {
    const loaded = loadedConfig(aliases);

    assert.deepEqual(getAliasForModel(nativeModels[0], loaded), aliases[0]);
    assert.deepEqual(getAliasForLookup("anthropic", "smart", loaded), aliases[1]);
    assert.equal(getAliasForLookup("openai", "missing", loaded), undefined);
});

test("rewrites provider request payloads only for object payloads", () => {
    assert.deepEqual(rewritePayloadModel({ model: "fast", messages: [] }, "gpt-5"), {
        model: "gpt-5",
        messages: [],
    });
    assert.deepEqual(rewritePayloadModel(["not", "object"], "gpt-5"), ["not", "object"]);
    assert.equal(rewritePayloadModel(null, "gpt-5"), null);
});

test("resolves provider request aliases from selected model or request payload", () => {
    const loaded = loadedConfig(aliases);
    const selectedAliasModel = applyAlias(nativeModels[0], aliases[0]);

    assert.deepEqual(
        aliasForProviderRequest({ model: "fast" }, selectedAliasModel, loaded),
        aliases[0],
    );
    assert.deepEqual(
        aliasForProviderRequest({ model: "smart" }, nativeModels[1], loaded),
        aliases[1],
    );
    assert.equal(
        aliasForProviderRequest({ model: "claude-opus" }, nativeModels[1], loaded),
        undefined,
    );
    assert.equal(aliasForProviderRequest({ model: "fast" }, undefined, loaded), undefined);
});

test("model selector patch aliases snapshot display and search while preserving native models", () => {
    const state: RuntimeState = {
        loadSettings: () =>
            loadedConfig([aliases[0]], undefined, [{ provider: "openai", name: "OpenAI Work" }]),
    };
    const openaiModel = nativeModels[0];
    const anthropicModel = nativeModels[1];
    if (openaiModel === undefined || anthropicModel === undefined) {
        throw new Error("missing model fixture");
    }
    type ModelSelectorMockItem = {
        provider: string;
        id: string;
        model: ModelLike;
    };
    const modelItems: ModelSelectorMockItem[] = [
        {
            provider: "openai",
            id: "gpt-5",
            model: openaiModel,
        },
        {
            provider: "anthropic",
            id: "claude-opus",
            model: anthropicModel,
        },
    ];
    const successCheckmark = "\x1b[32m ✓\x1b[39m";
    const prototype = {
        allModels: [] as ModelSelectorMockItem[],
        scopedModelItems: [] as ModelSelectorMockItem[],
        activeModels: [] as ModelSelectorMockItem[],
        filteredModels: [] as ModelSelectorMockItem[],
        listContainer: { children: [] as unknown[] },
        searchInput: {
            render(width: number) {
                return [`> ${" ".repeat(Math.max(0, width - 2))}`];
            },
        },
        selectedIndex: 0,
        scope: "all",
        loadModelsFromSnapshot(): void {
            this.allModels = modelItems;
            this.scopedModelItems = [];
            this.activeModels = modelItems;
            this.filteredModels = modelItems;
        },
        filterModels(query: string): void {
            const normalizedQuery = query.toLowerCase();
            this.filteredModels = this.activeModels.filter((item) => {
                const searchable = `${item.provider} ${item.id} ${item.model.name ?? ""}`;
                return searchable.toLowerCase().includes(normalizedQuery);
            });
            this.updateList();
        },
        updateList(): void {
            this.listContainer.children = this.filteredModels.map((item, index) => {
                let prefix = "  ";
                let checkmark = "";
                if (index === this.selectedIndex) {
                    prefix = "→ ";
                    checkmark = successCheckmark;
                }
                return textComponent(`${prefix}${item.id} [${item.provider}]${checkmark}`);
            });
            this.listContainer.children.push(
                textComponent("  (1/2)"),
                {},
                textComponent("  Model Name: GPT-5"),
                {},
                textComponent("  Model catalogs refreshed."),
            );
        },
    };

    installModelSelectorProviderPatch(state, prototype);
    prototype.loadModelsFromSnapshot();
    prototype.updateList();

    assert.equal(prototype.allModels[0]?.provider, "OpenAI Work");
    assert.equal(prototype.allModels[0]?.model, openaiModel);
    assert.equal(prototype.allModels[0]?.id, "fast");
    assert.equal(prototype.activeModels[0]?.provider, "OpenAI Work");
    assert.deepEqual(textValues(prototype.listContainer.children), [
        `→ Fast${successCheckmark}       OpenAI Work`,
        "  Claude Opus  anthropic",
        "  Model catalogs refreshed.",
    ]);
    assert.equal(prototype.searchInput.render(20)[0], ">              (1/2)");

    prototype.filterModels("gpt-5");
    assert.equal(prototype.filteredModels.length, 1);
    assert.equal(prototype.filteredModels[0], prototype.allModels[0]);
    assert.equal(prototype.filteredModels[0]?.model, openaiModel);

    prototype.filterModels("OpenAI Work");
    assert.equal(prototype.filteredModels.length, 1);
    assert.equal(prototype.filteredModels[0], prototype.allModels[0]);

    prototype.filterModels("Fast");
    assert.equal(prototype.filteredModels.length, 1);
    assert.equal(prototype.filteredModels[0], prototype.allModels[0]);
});

test("model selector patch reapplies aliases after a refreshed snapshot", () => {
    let snapshot: ModelLike[] = [nativeModels[0]].filter(
        (model): model is ModelLike => model !== undefined,
    );
    const state: RuntimeState = {
        loadSettings: () => loadedConfig(aliases),
    };
    const prototype = {
        allModels: [] as Array<{ provider: string; id: string; model: ModelLike }>,
        scopedModelItems: [] as Array<{ provider: string; id: string; model: ModelLike }>,
        activeModels: [] as Array<{ provider: string; id: string; model: ModelLike }>,
        filteredModels: [] as Array<{ provider: string; id: string; model: ModelLike }>,
        selectedIndex: 0,
        scope: "all",
        loadModelsFromSnapshot(): void {
            this.allModels = snapshot.map((model) => ({
                provider: model.provider,
                id: model.id,
                model,
            }));
            this.activeModels = this.allModels;
            this.filteredModels = this.allModels;
        },
        filterModels(): void {},
        updateList(): void {},
    };

    installModelSelectorProviderPatch(state, prototype);
    prototype.loadModelsFromSnapshot();
    assert.deepEqual(
        prototype.allModels.map((item) => item.id),
        ["fast"],
    );

    snapshot = [...nativeModels];
    prototype.loadModelsFromSnapshot();
    assert.deepEqual(
        prototype.allModels.map((item) => item.id),
        ["fast", "smart"],
    );
    assert.deepEqual(
        prototype.allModels.map((item) => item.model.id),
        ["gpt-5", "claude-opus"],
    );
});

test("model selector provider patch can align providers to all filtered model names", () => {
    const shortModel: ModelLike = { provider: "p", id: "short", name: "Short" };
    const longModel: ModelLike = {
        provider: "p",
        id: "long",
        name: "Extremely Long Model Name",
    };
    const modelItems = [
        { provider: "p", id: "short", model: shortModel },
        ...Array.from({ length: 9 }, (_unused, index) => {
            return {
                provider: "p",
                id: `medium-${index}`,
                model: { provider: "p", id: `medium-${index}`, name: `Medium ${index}` },
            };
        }),
        { provider: "p", id: "long", model: longModel },
    ];

    function createPrototype() {
        return {
            allModels: modelItems,
            scopedModelItems: [],
            activeModels: modelItems,
            filteredModels: modelItems,
            listContainer: { children: [] as unknown[] },
            selectedIndex: 0,
            scope: "all",
            loadModelsFromSnapshot(): void {},
            filterModels(_query: string): void {
                return;
            },
            updateList(): void {
                const visibleItems = this.filteredModels.slice(0, 10);
                this.listContainer.children = visibleItems.map((item, index) => {
                    let prefix = "  ";
                    if (index === this.selectedIndex) {
                        prefix = "→ ";
                    }
                    return textComponent(`${prefix}${item.id} [${item.provider}]`);
                });
            },
        };
    }

    const stableState: RuntimeState = {
        loadSettings: () => loadedConfig([], undefined, [], true),
    };
    const stablePrototype = createPrototype();
    installModelSelectorProviderPatch(stableState, stablePrototype);
    stablePrototype.updateList();

    const visibleState: RuntimeState = {
        loadSettings: () => loadedConfig([], undefined, [], false),
    };
    const visiblePrototype = createPrototype();
    installModelSelectorProviderPatch(visibleState, visiblePrototype);
    visiblePrototype.updateList();

    assert.equal(
        textValues(stablePrototype.listContainer.children)[0],
        `→ Short${" ".repeat(22)}p`,
    );
    assert.equal(
        textValues(visiblePrototype.listContainer.children)[0],
        `→ Short${" ".repeat(5)}p`,
    );
});

test("scoped models patch aliases rendered and searched models without changing selection ids", () => {
    let currentLoaded = loadedConfig([aliases[0]], undefined, [
        { provider: "openai", name: "OpenAI Work" },
    ]);
    const state: RuntimeState = {
        loadSettings: () => currentLoaded,
    };
    type ScopedMockItem = {
        fullId: string;
        model: ModelLike;
        enabled: boolean;
    };
    type ScopedMock = {
        filteredItems: ScopedMockItem[];
        footerText: { setText(text: string): void };
        listContainer: { children: unknown[] };
        maxVisible: number;
        searchInput: { getValue(): string; render(width: number): string[] };
        selectedIndex: number;
        buildItems(this: ScopedMock): ScopedMockItem[];
        getFooterText(this: ScopedMock): string;
        refresh(this: ScopedMock): void;
        updateList(this: ScopedMock): void;
    };
    let query = "";
    const footerTexts: string[] = [];
    const openaiModel = nativeModels[0];
    if (openaiModel === undefined) {
        throw new Error("missing openai model fixture");
    }
    const originalItems: ScopedMockItem[] = [
        {
            fullId: "openai/gpt-5",
            model: openaiModel,
            enabled: true,
        },
    ];
    const successCheckmark = "\x1b[32m ✓\x1b[39m";
    const prototype: ScopedMock = {
        filteredItems: originalItems,
        footerText: {
            setText(text: string) {
                footerTexts.push(text);
            },
        },
        listContainer: { children: [] },
        maxVisible: 8,
        searchInput: {
            getValue() {
                return query;
            },
            render(width: number) {
                return [`> ${" ".repeat(Math.max(0, width - 2))}`];
            },
        },
        selectedIndex: 0,
        buildItems() {
            return originalItems;
        },
        getFooterText() {
            return "footer";
        },
        refresh() {
            this.filteredItems = [];
        },
        updateList() {
            this.listContainer.children = this.filteredItems.map((item, index) => {
                let prefix = "  ";
                if (index === this.selectedIndex) {
                    prefix = "→ ";
                }
                return textComponent(
                    `${prefix}${item.model.id} [${item.model.provider}]${successCheckmark}`,
                );
            });
            this.listContainer.children.push(
                textComponent("  (1/1)"),
                {},
                textComponent("  Model Name: GPT-5"),
            );
        },
    };

    installScopedModelsProviderPatch(state, prototype);
    prototype.updateList();
    assert.deepEqual(textValues(prototype.listContainer.children), [
        `→ Fast${successCheckmark}  OpenAI Work`,
    ]);

    currentLoaded = loadedConfig([aliases[0]]);
    query = "fast";
    prototype.refresh();

    assert.deepEqual(textValues(prototype.listContainer.children), [
        `→ Fast${successCheckmark}  openai`,
    ]);
    assert.equal(prototype.searchInput.render(20)[0], ">              (1/1)");
    assert.deepEqual(footerTexts, ["footer"]);
    assert.equal(prototype.filteredItems[0], originalItems[0]);
    assert.equal(prototype.filteredItems[0]?.model.id, "gpt-5");
    assert.equal(prototype.filteredItems[0]?.model.provider, "openai");
});

test("registry patch aliases list and lookup methods and updates config at runtime", () => {
    let loaded = loadedConfig([aliases[0]]);
    const state: RuntimeState = {
        loadSettings: () => loaded,
    };
    const registry: PatchedModelRegistry = {
        getAll() {
            return nativeModels;
        },
        getAvailable() {
            return [nativeModels[0]];
        },
        find(provider: string, modelId: string) {
            return nativeModels.find(
                (model) => model.provider === provider && model.id === modelId,
            );
        },
        getProviderDisplayName(provider: string) {
            return provider.toUpperCase();
        },
    };

    installRegistryPatch(registry, state);

    assert.deepEqual(
        registry.getAll().map((model) => model.id),
        ["fast", "claude-opus"],
    );
    assert.deepEqual(
        registry.getAvailable().map((model) => model.id),
        ["fast"],
    );
    assert.deepEqual(registry.find("openai", "fast"), {
        provider: "openai",
        id: "fast",
        name: "Fast",
    });
    assert.equal(registry.getProviderDisplayName("openai"), "OPENAI");

    loaded = loadedConfig([], undefined, [{ provider: "openai", name: "OpenAI Work" }]);
    installRegistryPatch(registry, state);

    assert.deepEqual(
        registry.getAll().map((model) => model.id),
        ["gpt-5", "claude-opus"],
    );
    assert.deepEqual(registry.find("openai", "gpt-5"), nativeModels[0]);
    assert.equal(registry.getProviderDisplayName("openai"), "OpenAI Work");
});
