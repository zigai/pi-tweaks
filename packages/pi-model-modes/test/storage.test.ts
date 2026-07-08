import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { setShowModeName } from "../src/settings.ts";
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
        const configPath = path.join(agentDir, "pi-model-modes", "config.json");
        const schemaPath = path.join(agentDir, "pi-model-modes", "config.schema.json");
        await scaffoldGlobalModesConfig();

        assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
            $schema: "./config.schema.json",
            version: 1,
            currentMode: "default",
            modeShowName: false,
            modeUseThinkingBorderColors: false,
            modeShowThinkingLevelStatus: false,
            modes: {},
        });
        assert.match(await readFile(schemaPath, "utf8"), /Pi mode config/);

        await writeFile(configPath, "{ not json", "utf8");
        await writeFile(schemaPath, "stale schema", "utf8");
        await scaffoldGlobalModesConfig();

        assert.equal(await readFile(configPath, "utf8"), "{ not json");
        assert.match(await readFile(schemaPath, "utf8"), /Pi mode config/);
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
        const configPath = path.join(agentDir, "pi-model-modes", "config.json");
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

        assert.throws(() => setShowModeName(true), /additional properties/);
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
