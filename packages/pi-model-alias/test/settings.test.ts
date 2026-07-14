import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "vitest";

import type { RuntimeState } from "../src/types.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-model-alias-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const settings = await import("../src/settings.ts");
const configPath = settings.getGlobalConfigPath();
const schemaPath = join(agentDir, "extension-settings", "schemas", "pi-model-alias.schema.json");
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
        loadSettings() {
            return settings.loadModelAliasSettings(state);
        },
    };
    return state;
}

test("loadModelAliasSettings scaffolds defaults for a missing aliases file", async () => {
    await rm(configPath, { force: true });
    const loaded = settings.loadModelAliasSettings(runtimeState());

    assert.equal(loaded.path, configPath);
    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.equal(loaded.stableProviderColumn, true);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
        $schema: "./schemas/pi-model-alias.schema.json",
        aliases: [],
        providerAliases: [],
        stableProviderColumn: true,
    });
    assert.match(await readFile(schemaPath, "utf8"), /Pi Model Alias settings/);

    await writeFile(schemaPath, "stale schema", "utf8");
    await writeFile(configPath, "{ not json", "utf8");
    const loadedAgain = settings.loadModelAliasSettings(runtimeState());

    assert.match(loadedAgain.error ?? "", /Failed to load/);
    assert.equal(await readFile(configPath, "utf8"), "{ not json");
    assert.match(await readFile(schemaPath, "utf8"), /Pi Model Alias settings/);
});

test("loadModelAliasSettings refreshes schema while reusing an unchanged config", async () => {
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
    const loaded = settings.loadModelAliasSettings(state);

    await writeFile(schemaPath, "stale after scaffold", "utf8");
    const loadedAgain = settings.loadModelAliasSettings(state);

    assert.equal(loadedAgain, loaded);
    assert.match(await readFile(schemaPath, "utf8"), /Pi Model Alias settings/);
});

test("loadModelAliasSettings parses and trims valid aliases", async () => {
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

    const loaded = settings.loadModelAliasSettings(runtimeState());

    assert.equal(loaded.error, undefined);
    assert.deepEqual(loaded.aliases, [
        { provider: "openai", model: "gpt-5", alias: "fast", name: "Fast Model" },
    ]);
    assert.deepEqual(loaded.providerAliases, [{ provider: "anthropic", name: "Claude Work" }]);
    assert.equal(loaded.stableProviderColumn, false);
});

test("loadModelAliasSettings migrates and selects a trusted legacy project config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-model-alias-project-"));
    try {
        const legacyPath = join(cwd, ".pi", "pi-model-alias", "settings.json");
        await mkdir(join(cwd, ".pi", "pi-model-alias"), { recursive: true });
        await writeFile(
            legacyPath,
            JSON.stringify({
                aliases: [{ provider: "openai", model: "gpt-5", alias: "project" }],
            }),
            "utf8",
        );
        const state = runtimeState();
        state.configCwd = cwd;
        state.projectTrusted = true;

        const loaded = settings.loadModelAliasSettings(state);

        assert.equal(loaded.path, join(cwd, ".pi", "extension-settings", "pi-model-alias.json"));
        assert.equal(loaded.aliases[0]?.alias, "project");
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("loadModelAliasSettings rejects duplicate aliases without throwing", async () => {
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

    const loaded = settings.loadModelAliasSettings(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /duplicates aliases\[0\]/);
});

test("loadModelAliasSettings rejects unknown config keys", async () => {
    await writeFile(
        configPath,
        JSON.stringify({
            aliases: [{ provider: "openai", model: "gpt-5", alias: "fast", note: "typo" }],
        }),
        "utf8",
    );

    const loaded = settings.loadModelAliasSettings(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /schema|property|ignored/);
});

test("loadModelAliasSettings rejects duplicate provider aliases without throwing", async () => {
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

    const loaded = settings.loadModelAliasSettings(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /duplicates providerAliases\[0\]/);
});

test("loadModelAliasSettings returns a readable error for malformed JSON", async () => {
    await writeFile(configPath, "{ not json", "utf8");

    const loaded = settings.loadModelAliasSettings(runtimeState());

    assert.deepEqual(loaded.aliases, []);
    assert.deepEqual(loaded.providerAliases, []);
    assert.match(loaded.error ?? "", /Failed to load/);
    assert.equal(await readFile(configPath, "utf8"), "{ not json");
});
