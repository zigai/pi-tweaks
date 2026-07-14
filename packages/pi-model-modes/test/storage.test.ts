import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { getConfiguredModeShortcuts, setUseThinkingBorderColors } from "../src/settings.ts";
import { atomicWriteUtf8, scaffoldGlobalModesConfig, withFileLock } from "../src/storage.ts";

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
        assert.deepEqual(getConfiguredModeShortcuts(), {});

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
        assert.deepEqual(getConfiguredModeShortcuts(), {
            forward: "ctrl+space",
            backward: "shift+ctrl+space",
        });
    } finally {
        await rm(agentDir, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("scaffoldGlobalModesConfig copies legacy global config when new config is missing", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = path.join(agentDir, "extension-settings", "pi-model-modes.json");
        const legacyConfigPath = path.join(agentDir, "pi-mode", "config.json");
        const legacyConfig = {
            version: 1,
            currentMode: "deep",
            modes: {
                deep: {
                    provider: "openai",
                    modelId: "gpt-5",
                    thinkingLevel: "high",
                },
            },
        };

        await mkdir(path.dirname(legacyConfigPath), { recursive: true });
        await writeFile(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, "utf8");

        await scaffoldGlobalModesConfig();

        assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
            $schema: "./schemas/pi-model-modes.schema.json",
            ...legacyConfig,
        });
        assert.deepEqual(JSON.parse(await readFile(legacyConfigPath, "utf8")), legacyConfig);
    } finally {
        await rm(agentDir, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("setting writes copy legacy global config before updating new config", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-model-modes-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = path.join(agentDir, "extension-settings", "pi-model-modes.json");
        const legacyConfigPath = path.join(agentDir, "pi-mode", "config.json");
        const legacyConfig = {
            version: 1,
            currentMode: "default",
            modes: {
                default: {
                    provider: "openai",
                    modelId: "gpt-5",
                },
            },
        };

        await mkdir(path.dirname(legacyConfigPath), { recursive: true });
        await writeFile(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, "utf8");

        setUseThinkingBorderColors(true);

        const migratedConfig: unknown = JSON.parse(await readFile(configPath, "utf8"));
        if (typeof migratedConfig !== "object" || migratedConfig === null) {
            assert.fail("expected migrated configuration object");
        }
        const modeUseThinkingBorderColors: unknown = Object.getOwnPropertyDescriptor(
            migratedConfig,
            "modeUseThinkingBorderColors",
        )?.value as unknown;
        const currentMode: unknown = Object.getOwnPropertyDescriptor(migratedConfig, "currentMode")
            ?.value as unknown;
        const modes: unknown = Object.getOwnPropertyDescriptor(migratedConfig, "modes")
            ?.value as unknown;
        assert.equal(modeUseThinkingBorderColors, true);
        assert.equal(currentMode, "default");
        assert.deepEqual(modes, legacyConfig.modes);
        assert.deepEqual(JSON.parse(await readFile(legacyConfigPath, "utf8")), legacyConfig);
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

        assert.throws(() => setUseThinkingBorderColors(true), /additional properties/);
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
