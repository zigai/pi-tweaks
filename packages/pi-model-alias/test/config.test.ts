import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

import type { RuntimeState } from "../src/types.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-model-alias-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const config = await import("../src/config.ts");

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

test("safeReadConfig returns empty aliases for a missing aliases file", () => {
    const loaded = config.safeReadConfig(runtimeState());

    assert.equal(loaded.path, config.CONFIG_FILE);
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.aliases, []);
});

test("safeReadConfig parses and trims valid aliases", async () => {
    await writeFile(
        config.CONFIG_FILE,
        JSON.stringify({
            aliases: [
                {
                    provider: " openai ",
                    model: " gpt-5 ",
                    alias: " fast ",
                    name: " Fast Model ",
                },
            ],
        }),
        "utf8",
    );

    const loaded = config.safeReadConfig(runtimeState());

    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.aliases, [
        { provider: "openai", model: "gpt-5", alias: "fast", name: "Fast Model" },
    ]);
});

test("safeReadConfig rejects duplicate aliases without throwing", async () => {
    await writeFile(
        config.CONFIG_FILE,
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
    assert.match(loaded.error ?? "", /duplicates aliases\[0\]/);
});

test("safeReadConfig returns a readable error for malformed JSON", async () => {
    await writeFile(config.CONFIG_FILE, "{ not json", "utf8");

    const loaded = config.safeReadConfig(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.match(loaded.error ?? "", /Failed to load/);
});
