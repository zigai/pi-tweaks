import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, test } from "vitest";

import type { LoadedConfig, ModelLike, PatchedModelRegistry, RuntimeState } from "../src/index.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-model-filter-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

import type * as ModelFilter from "../src/index.ts";

const modelFilter = (await import("../src/index.ts")) as unknown as typeof ModelFilter;
const configPath = join(agentDir, "model-filters.json");

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

const models: ModelLike[] = [
    { provider: "openai", id: "gpt-5" },
    { provider: "openai", id: "gpt-5-mini" },
    { provider: "anthropic", id: "claude-opus" },
    { provider: "local.v1", id: "llama" },
];

function loadedConfig(
    include: LoadedConfig["includeRules"],
    exclude: LoadedConfig["excludeRules"],
): LoadedConfig {
    return {
        path: configPath,
        mtimeMs: 1,
        includeRules: include,
        excludeRules: exclude,
    };
}

test("glob patterns match complete provider and model ids", () => {
    assert.equal(modelFilter.globToRegex("gpt-*").test("gpt-5"), true);
    assert.equal(modelFilter.globToRegex("gpt-?").test("gpt-55"), false);
    assert.equal(modelFilter.globToRegex("local.v1").test("local-v1"), false);
    assert.equal(modelFilter.globToRegex("local.v1").test("local.v1"), true);
});

test("include rules constrain matching providers while excludes always hide models", () => {
    const includeRules = modelFilter.normalizeRules([{ provider: "openai", models: ["gpt-*"] }]);
    const excludeRules = modelFilter.normalizeRules([{ provider: "*", models: ["*-mini"] }]);
    const visible = modelFilter.filterModels(models, loadedConfig(includeRules, excludeRules));

    assert.deepEqual(
        visible.map((model) => `${model.provider}/${model.id}`),
        ["openai/gpt-5", "anthropic/claude-opus", "local.v1/llama"],
    );
});

test("safeReadConfig falls back for missing and malformed config files", async () => {
    await rm(configPath, { force: true });
    const state: RuntimeState = {
        loadConfig() {
            return modelFilter.safeReadConfig(state);
        },
    };

    const missing = modelFilter.safeReadConfig(state);
    assert.deepEqual(missing.includeRules, []);
    assert.deepEqual(missing.excludeRules, []);
    assert.equal(missing.error, undefined);

    await writeFile(configPath, "{ not json", "utf8");
    state.configCache = undefined;
    const malformed = modelFilter.safeReadConfig(state);
    assert.match(malformed.error ?? "", /Failed to load/);
    assert.deepEqual(malformed.includeRules, []);
    assert.deepEqual(malformed.excludeRules, []);
});

test("safeReadConfig parses and trims valid config rules", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            include: [{ provider: " openai ", models: [" gpt-* "] }],
            exclude: [{ provider: " * ", models: [" *-mini "] }],
        }),
        "utf8",
    );
    const state: RuntimeState = {
        loadConfig() {
            return modelFilter.safeReadConfig(state);
        },
    };

    const loaded = modelFilter.safeReadConfig(state);
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.includeRules[0]?.providerPattern, "openai");
    assert.deepEqual(loaded.includeRules[0]?.modelPatterns, ["gpt-*"]);
    assert.deepEqual(loaded.excludeRules[0]?.providerPattern, "*");
    assert.deepEqual(loaded.excludeRules[0]?.modelPatterns, ["*-mini"]);
});

test("registry patch filters list and lookup results and remains idempotent", () => {
    let loaded = loadedConfig(
        modelFilter.normalizeRules([{ provider: "openai", models: ["gpt-5"] }]),
        modelFilter.normalizeRules([{ provider: "*", models: ["*-mini"] }]),
    );
    const state: RuntimeState = {
        loadConfig() {
            return loaded;
        },
    };
    const registry: PatchedModelRegistry = {
        getAll() {
            return models;
        },
        getAvailable() {
            return [models[0], models[1]];
        },
        find(provider: string, modelId: string) {
            return models.find((model) => model.provider === provider && model.id === modelId);
        },
    };

    modelFilter.installRegistryPatch(registry, state);
    modelFilter.installRegistryPatch(registry, state);

    assert.deepEqual(
        registry.getAll().map((model) => model.id),
        ["gpt-5", "claude-opus", "llama"],
    );
    assert.deepEqual(
        registry.getAvailable().map((model) => model.id),
        ["gpt-5"],
    );
    assert.equal(registry.find("openai", "gpt-5-mini"), undefined);
    assert.deepEqual(registry.find("openai", "gpt-5"), models[0]);

    loaded = loadedConfig([], []);
    assert.deepEqual(
        registry.getAll().map((model) => model.id),
        ["gpt-5", "gpt-5-mini", "claude-opus", "llama"],
    );
});
