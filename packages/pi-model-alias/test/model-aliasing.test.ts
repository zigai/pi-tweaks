import assert from "node:assert/strict";
import { test } from "vitest";

import {
    aliasModels,
    applyAlias,
    getAliasForLookup,
    getAliasForModel,
    getAliasModelIdCollision,
} from "../src/model-aliasing.ts";
import { aliasForProviderRequest, rewritePayloadModel } from "../src/provider-payload.ts";
import { installRegistryPatch, type PatchedModelRegistry } from "../src/registry-patch.ts";
import type { AliasConfig, LoadedConfig, ModelLike, RuntimeState } from "../src/types.ts";

function loadedConfig(aliases: AliasConfig[], error?: string): LoadedConfig {
    const loaded: LoadedConfig = {
        path: "model-aliases.json",
        mtimeMs: 1,
        aliases,
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

    loaded = loadedConfig([]);
    installRegistryPatch(registry, state);

    assert.deepEqual(
        registry.getAll().map((model) => model.id),
        ["gpt-5", "claude-opus"],
    );
    assert.deepEqual(registry.find("openai", "gpt-5"), nativeModels[0]);
});
