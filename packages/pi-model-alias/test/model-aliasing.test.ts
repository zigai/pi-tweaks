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
): LoadedConfig {
    const loaded: LoadedConfig = {
        path: "model-aliases.json",
        mtimeMs: 1,
        aliases,
        providerAliases,
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

test("aliases models without mutating unrelated models", () => {
    const loaded = loadedConfig(aliases);
    const aliased = aliasModels(nativeModels, loaded);

    assert.deepEqual(aliased, [
        { provider: "openai", id: "fast", name: "Fast" },
        { provider: "anthropic", id: "smart", name: "smart" },
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

test("model selector provider patch aliases display providers only", async () => {
    const state: RuntimeState = {
        loadConfig: () =>
            loadedConfig([], undefined, [{ provider: "openai", name: "OpenAI Work" }]),
    };
    const openaiModel = nativeModels[0];
    if (openaiModel === undefined) {
        throw new Error("missing openai model fixture");
    }
    const modelItem = {
        provider: "openai",
        id: "gpt-5",
        model: openaiModel,
    };
    type ModelSelectorMockItem = typeof modelItem;
    const prototype = {
        allModels: [] as ModelSelectorMockItem[],
        scopedModelItems: [] as ModelSelectorMockItem[],
        activeModels: [] as ModelSelectorMockItem[],
        filteredModels: [] as ModelSelectorMockItem[],
        scope: "all",
        async loadModels(): Promise<void> {
            this.allModels = [modelItem];
            this.scopedModelItems = [];
            this.activeModels = [modelItem];
            this.filteredModels = [modelItem];
        },
        filterModels(_query: string): void {
            this.filteredModels = this.activeModels;
        },
        updateList(): void {},
    };

    installModelSelectorProviderPatch(state, prototype);
    await prototype.loadModels();

    assert.equal(prototype.allModels[0]?.provider, "OpenAI Work");
    assert.equal(prototype.allModels[0]?.model.provider, "openai");
    assert.equal(prototype.activeModels[0]?.provider, "OpenAI Work");
});

test("scoped models provider patch aliases rendered and searched providers only", () => {
    const state: RuntimeState = {
        loadConfig: () =>
            loadedConfig([], undefined, [{ provider: "openai", name: "OpenAI Work" }]),
    };
    type ScopedMockItem = {
        fullId: string;
        model: ModelLike;
        enabled: boolean;
    };
    type ScopedMock = {
        filteredItems: ScopedMockItem[];
        footerText: { setText(text: string): void };
        searchInput: { getValue(): string };
        selectedIndex: number;
        buildItems(this: ScopedMock): ScopedMockItem[];
        getFooterText(this: ScopedMock): string;
        refresh(this: ScopedMock): void;
        updateList(this: ScopedMock): void;
    };
    let query = "";
    const renderedProviders: string[] = [];
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
    const prototype: ScopedMock = {
        filteredItems: originalItems,
        footerText: {
            setText(text: string) {
                footerTexts.push(text);
            },
        },
        searchInput: {
            getValue() {
                return query;
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
            const first = this.filteredItems[0];
            if (first !== undefined) {
                renderedProviders.push(first.model.provider);
            }
        },
    };

    installScopedModelsProviderPatch(state, prototype);
    prototype.updateList();
    query = "Work";
    prototype.refresh();

    assert.deepEqual(renderedProviders, ["OpenAI Work", "OpenAI Work"]);
    assert.deepEqual(footerTexts, ["footer"]);
    assert.equal(prototype.filteredItems[0], originalItems[0]);
    assert.equal(prototype.filteredItems[0]?.model.provider, "openai");
});

test("registry patch aliases list and lookup methods and updates config at runtime", () => {
    let loaded = loadedConfig([aliases[0]]);
    const state: RuntimeState = {
        loadConfig: () => loaded,
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
