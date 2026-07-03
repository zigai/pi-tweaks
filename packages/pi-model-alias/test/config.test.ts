import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

import type { RuntimeState } from "../src/types.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-model-alias-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const config = await import("../src/config.ts");
const configPath = config.getGlobalConfigPath();
const schemaPath = join(agentDir, "pi-model-alias", "config.schema.json");
await mkdir(join(configPath, ".."), { recursive: true });

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

function runtimeState(): RuntimeState {
    const state: RuntimeState = {
        loadConfig() {
            return config.safeReadConfig(state);
        },
    };
    return state;
}

test("safeReadConfig scaffolds defaults for a missing aliases file", async () => {
    await rm(configPath, { force: true });
    const loaded = config.safeReadConfig(runtimeState());

    assert.equal(loaded.path, configPath);
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.equal(loaded.stableProviderColumn, true);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
        $schema: "./config.schema.json",
        aliases: [],
        providerAliases: [],
        stableProviderColumn: true,
    });
    assert.match(await readFile(schemaPath, "utf8"), /Pi model and provider alias config/);

    await writeFile(schemaPath, "stale schema", "utf8");
    await writeFile(configPath, "{ not json", "utf8");
    const loadedAgain = config.safeReadConfig(runtimeState());

    assert.match(loadedAgain.error ?? "", /Failed to load/);
    assert.equal(await readFile(configPath, "utf8"), "{ not json");
    assert.equal(await readFile(schemaPath, "utf8"), "stale schema");
});

test("safeReadConfig skips global scaffolding after the first load for a config path", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            aliases: [],
            providerAliases: [],
            stableProviderColumn: true,
        }),
        "utf8",
    );
    const state = runtimeState();
    const loaded = config.safeReadConfig(state);

    await writeFile(schemaPath, "stale after scaffold", "utf8");
    const loadedAgain = config.safeReadConfig(state);

    assert.equal(loadedAgain, loaded);
    assert.equal(await readFile(schemaPath, "utf8"), "stale after scaffold");
});

test("safeReadConfig parses and trims valid aliases", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            aliases: [
                {
                    provider: " openai ",
                    model: " gpt-5 ",
                    alias: " fast ",
                    name: " Fast Model ",
                },
            ],
            providerAliases: [{ provider: " anthropic ", name: " Claude Work " }],
            stableProviderColumn: false,
        }),
        "utf8",
    );

    const loaded = config.safeReadConfig(runtimeState());

    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.aliases, [
        { provider: "openai", model: "gpt-5", alias: "fast", name: "Fast Model" },
    ]);
    assert.deepEqual(loaded.providerAliases, [{ provider: "anthropic", name: "Claude Work" }]);
    assert.equal(loaded.stableProviderColumn, false);
});

test("safeReadConfig rejects duplicate aliases without throwing", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            aliases: [
                { provider: "openai", model: "gpt-5", alias: "fast" },
                { provider: "openai", model: "gpt-4", alias: "fast" },
            ],
        }),
        "utf8",
    );

    const loaded = config.safeReadConfig(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /duplicates aliases\[0\]/);
});

test("safeReadConfig rejects unknown config keys", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            aliases: [{ provider: "openai", model: "gpt-5", alias: "fast", note: "typo" }],
        }),
        "utf8",
    );

    const loaded = config.safeReadConfig(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /additional properties/);
});

test("safeReadConfig rejects duplicate provider aliases without throwing", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            providerAliases: [
                { provider: "openai", name: "OpenAI Work" },
                { provider: "openai", name: "OpenAI Personal" },
            ],
        }),
        "utf8",
    );

    const loaded = config.safeReadConfig(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /duplicates providerAliases\[0\]/);
});

test("safeReadConfig returns a readable error for malformed JSON", async () => {
    await writeFile(configPath, "{ not json", "utf8");

    const loaded = config.safeReadConfig(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /Failed to load/);
    assert.equal(await readFile(configPath, "utf8"), "{ not json");
});
