import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, test } from "vitest";

import type {
    LoadedConfig,
    ModelLike,
    PatchedModelRegistry,
    PatchedModelRuntime,
    RuntimeState,
} from "../src/index.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-model-filter-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const modelFilter = await import("../src/index.ts");
const configPath = join(agentDir, "extension-settings", "pi-model-filter.json");
const schemaPath = join(agentDir, "extension-settings", "schemas", "pi-model-filter.schema.json");

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

await mkdir(join(agentDir, "extension-settings"), { recursive: true });

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

test("loadModelFilterSettings falls back for missing and malformed config files", async () => {
    await rm(configPath, { force: true });
    const state: RuntimeState = {
        loadSettings() {
            return modelFilter.loadModelFilterSettings(state);
        },
    };

    const missing = modelFilter.loadModelFilterSettings(state);
    assert.deepEqual(missing.includeRules, []);
    assert.deepEqual(missing.excludeRules, []);
    assert.equal(missing.error, undefined);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
        $schema: "./schemas/pi-model-filter.schema.json",
        include: [],
        exclude: [],
    });
    assert.match(await readFile(schemaPath, "utf8"), /Pi Model Filter settings/);

    await writeFile(schemaPath, "stale schema", "utf8");
    state.configCache = undefined;
    modelFilter.loadModelFilterSettings(state);
    assert.match(await readFile(schemaPath, "utf8"), /Pi Model Filter settings/);

    await writeFile(configPath, "{ not json", "utf8");
    state.configCache = undefined;
    const malformed = modelFilter.loadModelFilterSettings(state);
    assert.match(malformed.error ?? "", /Failed to load/);
    assert.deepEqual(malformed.includeRules, []);
    assert.deepEqual(malformed.excludeRules, []);
    assert.equal(await readFile(configPath, "utf8"), "{ not json");
    await writeFile(schemaPath, "stale schema", "utf8");
    state.configCache = undefined;
    modelFilter.loadModelFilterSettings(state);
    assert.equal(await readFile(configPath, "utf8"), "{ not json");
    assert.match(await readFile(schemaPath, "utf8"), /Pi Model Filter settings/);
});

test("loadModelFilterSettings refreshes schema while reusing an unchanged config", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            include: [],
            exclude: [],
        }),
        "utf8",
    );
    const state: RuntimeState = {
        loadSettings() {
            return modelFilter.loadModelFilterSettings(state);
        },
    };
    const loaded = modelFilter.loadModelFilterSettings(state);

    await writeFile(schemaPath, "stale after scaffold", "utf8");
    const loadedAgain = modelFilter.loadModelFilterSettings(state);

    assert.equal(loadedAgain, loaded);
    assert.match(await readFile(schemaPath, "utf8"), /Pi Model Filter settings/);
});

test("loadModelFilterSettings parses and trims valid config rules", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            include: [{ provider: " openai ", models: [" gpt-* "] }],
            exclude: [{ provider: " * ", models: [" *-mini "] }],
        }),
        "utf8",
    );
    const state: RuntimeState = {
        loadSettings() {
            return modelFilter.loadModelFilterSettings(state);
        },
    };

    const loaded = modelFilter.loadModelFilterSettings(state);
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.includeRules[0]?.providerPattern, "openai");
    assert.deepEqual(loaded.includeRules[0]?.modelPatterns, ["gpt-*"]);
    assert.deepEqual(loaded.excludeRules[0]?.providerPattern, "*");
    assert.deepEqual(loaded.excludeRules[0]?.modelPatterns, ["*-mini"]);
});

test("loadModelFilterSettings rejects unknown config keys", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            include: [{ provider: "openai", models: ["gpt-*"], note: "typo" }],
        }),
        "utf8",
    );
    const state: RuntimeState = {
        loadSettings() {
            return modelFilter.loadModelFilterSettings(state);
        },
    };

    const loaded = modelFilter.loadModelFilterSettings(state);
    assert.deepEqual(loaded.includeRules, []);
    assert.deepEqual(loaded.excludeRules, []);
    assert.match(loaded.error ?? "", /schema|property|ignored/);
});

test("registry patch filters list and lookup results and remains idempotent", () => {
    let loaded = loadedConfig(
        modelFilter.normalizeRules([{ provider: "openai", models: ["gpt-5"] }]),
        modelFilter.normalizeRules([{ provider: "*", models: ["*-mini"] }]),
    );
    const state: RuntimeState = {
        loadSettings() {
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

test("model runtime patch filters synchronous and asynchronous model views", async () => {
    let loaded = loadedConfig(
        modelFilter.normalizeRules([{ provider: "openai", models: ["gpt-5"] }]),
        modelFilter.normalizeRules([{ provider: "*", models: ["*-mini"] }]),
    );
    const state: RuntimeState = {
        loadSettings() {
            return loaded;
        },
    };
    const runtime: PatchedModelRuntime = {
        getModels(providerId?: string) {
            if (providerId === undefined) return models;
            return models.filter((model) => model.provider === providerId);
        },
        async getAvailable(providerId?: string) {
            if (providerId === undefined) return models;
            return models.filter((model) => model.provider === providerId);
        },
        getAvailableSnapshot() {
            return models;
        },
        getModel(providerId: string, modelId: string) {
            return models.find((model) => model.provider === providerId && model.id === modelId);
        },
    };

    modelFilter.installModelRuntimePatch(runtime, state);
    modelFilter.installModelRuntimePatch(runtime, state);

    assert.deepEqual(
        runtime.getModels().map((model) => model.id),
        ["gpt-5", "claude-opus", "llama"],
    );
    assert.deepEqual(
        runtime.getAvailableSnapshot().map((model) => model.id),
        ["gpt-5", "claude-opus", "llama"],
    );
    assert.deepEqual(
        (await runtime.getAvailable("openai")).map((model) => model.id),
        ["gpt-5"],
    );
    assert.equal(runtime.getModel("openai", "gpt-5-mini"), undefined);
    assert.deepEqual(runtime.getModel("openai", "gpt-5"), models[0]);

    loaded = loadedConfig([], []);
    assert.deepEqual(
        (await runtime.getAvailable()).map((model) => model.id),
        ["gpt-5", "gpt-5-mini", "claude-opus", "llama"],
    );
});
