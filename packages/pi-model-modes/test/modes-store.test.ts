import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { getConfiguredModeShortcuts, setUseThinkingBorderColors } from "../src/settings.ts";
import {
    atomicWriteUtf8,
    ModesStore,
    scaffoldGlobalModesConfig,
    withFileLock,
} from "../src/modes-store.ts";

async function exists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

test("scaffoldGlobalModesConfig creates missing global config and schema", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = path.join(agentDir, "extension-settings", "pi-model-modes.json");
        const schemaPath = path.join(
            agentDir,
            "extension-settings",
            "schemas",
            "pi-model-modes.schema.json",
        );
        await scaffoldGlobalModesConfig();

        assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
            $schema: "./schemas/pi-model-modes.schema.json",
            version: 1,
            currentMode: "default",
            modeUseThinkingBorderColors: false,
            modeShowThinkingLevelStatus: false,
            modes: {},
        });
        assert.match(await readFile(schemaPath, "utf8"), /Pi Model Modes settings/);

        await writeFile(configPath, "{ not json", "utf8");
        await writeFile(schemaPath, "stale schema", "utf8");
        await scaffoldGlobalModesConfig();

        assert.equal(await readFile(configPath, "utf8"), "{ not json");
        assert.match(await readFile(schemaPath, "utf8"), /Pi Model Modes settings/);
    } finally {
        await rm(agentDir, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("mode cycle shortcuts are optional and read from global config", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = path.join(agentDir, "extension-settings", "pi-model-modes.json");
        await scaffoldGlobalModesConfig();
        assert.deepEqual(
            getConfiguredModeShortcuts({ cwd: process.cwd(), projectTrusted: false }),
            {},
        );

        await writeFile(
            configPath,
            JSON.stringify({
                shortcuts: {
                    forward: "ctrl+space",
                    backward: "shift+ctrl+space",
                },
            }),
            "utf8",
        );
        assert.deepEqual(
            getConfiguredModeShortcuts({ cwd: process.cwd(), projectTrusted: false }),
            {
                forward: "ctrl+space",
                backward: "shift+ctrl+space",
            },
        );
    } finally {
        await rm(agentDir, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("mode config writes reject unknown config keys", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = path.join(agentDir, "extension-settings", "pi-model-modes.json");
        await scaffoldGlobalModesConfig();
        const invalidConfig = JSON.stringify({
            version: 1,
            currentMode: "default",
            modes: {
                default: {
                    provider: "openai",
                    modelId: "gpt-5",
                    extra: "typo",
                },
            },
        });
        await writeFile(configPath, invalidConfig, "utf8");

        assert.throws(
            () => setUseThinkingBorderColors({ cwd: process.cwd(), projectTrusted: false }, true),
            /additional properties/,
        );
        assert.equal(await readFile(configPath, "utf8"), invalidConfig);
    } finally {
        await rm(agentDir, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("ModesStore prepares settings once while resolving and loading a mode file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-prepared-"));
    const globalConfigPath = path.join(dir, "pi-model-modes.json");
    const projectConfigPath = path.join(dir, "project", "pi-model-modes.json");
    let settingsLoads = 0;
    const store = new ModesStore(() => {
        settingsLoads += 1;
        return { globalConfigPath, projectConfigPath };
    });

    try {
        await writeFile(
            globalConfigPath,
            JSON.stringify({
                version: 1,
                currentMode: "default",
                modes: { default: { provider: "openai", modelId: "gpt-5" } },
            }),
            "utf8",
        );

        const resolvedPath = await store.resolvePath({ cwd: dir, projectTrusted: false });
        const loaded = await store.load(resolvedPath, {
            provider: "openai",
            modelId: "gpt-5",
        });

        assert.equal(resolvedPath, globalConfigPath);
        assert.equal(loaded.currentMode, "default");
        assert.equal(settingsLoads, 1);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("atomicWriteUtf8 creates parent directories and replaces existing content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-storage-"));
    try {
        const filePath = path.join(dir, "nested", "modes.json");
        await atomicWriteUtf8(filePath, "first");
        await atomicWriteUtf8(filePath, "second");

        assert.equal(await readFile(filePath, "utf8"), "second");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("withFileLock removes lock files when the callback throws", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-storage-"));
    try {
        const filePath = path.join(dir, "modes.json");
        const lockPath = `${filePath}.lock`;

        await assert.rejects(
            withFileLock(filePath, async () => {
                throw new Error("boom");
            }),
            /boom/,
        );

        assert.equal(await exists(lockPath), false);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("withFileLock removes stale locks before running the callback", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-storage-"));
    try {
        const filePath = path.join(dir, "modes.json");
        const lockPath = `${filePath}.lock`;
        await writeFile(lockPath, "stale", "utf8");
        const oldDate = new Date(Date.now() - 60_000);
        await utimes(lockPath, oldDate, oldDate);

        const result = await withFileLock(filePath, async () => "locked");

        assert.equal(result, "locked");
        assert.equal(await exists(lockPath), false);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("ModesStore merges a local patch into the latest file under its lock", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-store-"));
    const filePath = path.join(dir, "modes.json");
    const fallback = { provider: "openai", modelId: "gpt-5", thinkingLevel: "medium" as const };
    const store = new ModesStore();
    try {
        await writeFile(
            filePath,
            JSON.stringify({
                version: 1,
                currentMode: "default",
                modes: { default: fallback, remote: { provider: "remote", modelId: "new" } },
            }),
            "utf8",
        );
        const baseline = {
            version: 1 as const,
            currentMode: "default",
            modes: { default: fallback },
        };
        const next = {
            ...baseline,
            modes: { default: { ...fallback, thinkingLevel: "high" as const } },
        };

        const saved = await store.saveChanges(filePath, baseline, next, fallback);

        assert.equal(saved?.data.modes.default?.thinkingLevel, "high");
        assert.deepEqual(saved?.data.modes.remote, { provider: "remote", modelId: "new" });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
