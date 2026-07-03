import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { loadFooterConfig, resolveFooterConfig } from "../src/settings.ts";

test("loadFooterConfig scaffolds missing global config and schema", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-footer-agent-"));
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-footer-cwd-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = path.join(agentDir, "pi-footer", "config.json");
        const schemaPath = path.join(agentDir, "pi-footer", "config.schema.json");
        const loaded = loadFooterConfig(cwd, false);

        assert.deepEqual(loaded.errors, []);
        assert.equal(loaded.config.separator, "|");
        assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
            $schema: "./config.schema.json",
            separator: "|",
        });
        assert.match(await readFile(schemaPath, "utf8"), /Pi footer config/);

        const customConfig = JSON.stringify({ separator: "/" });
        await writeFile(configPath, customConfig, "utf8");
        await writeFile(schemaPath, "stale schema", "utf8");
        const loadedAgain = loadFooterConfig(cwd, false);

        assert.equal(loadedAgain.config.separator, "/");
        assert.equal(await readFile(configPath, "utf8"), customConfig);
        assert.match(await readFile(schemaPath, "utf8"), /Pi footer config/);
    } finally {
        await rm(agentDir, { recursive: true, force: true });
        await rm(cwd, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("resolveFooterConfig defaults to pipe separator", () => {
    const loaded = resolveFooterConfig([]);

    assert.equal(loaded.config.separator, "|");
    assert.deepEqual(loaded.errors, []);
});

test("resolveFooterConfig reads and sanitizes separator setting", () => {
    const loaded = resolveFooterConfig([
        {
            label: "global settings",
            settings: {
                separator: "  ·\n",
            },
        },
    ]);

    assert.equal(loaded.config.separator, "·");
    assert.deepEqual(loaded.errors, []);
});

test("resolveFooterConfig lets later sources override earlier sources", () => {
    const loaded = resolveFooterConfig([
        {
            label: "global settings",
            settings: {
                separator: "|",
            },
        },
        {
            label: "project settings",
            settings: {
                separator: "/",
            },
        },
    ]);

    assert.equal(loaded.config.separator, "/");
});

test("resolveFooterConfig reports invalid separator settings", () => {
    const loaded = resolveFooterConfig([
        {
            label: "global settings",
            settings: {
                separator: "   ",
            },
        },
    ]);

    assert.equal(loaded.config.separator, "|");
    assert.deepEqual(loaded.errors, [
        "global settings.separator must contain a visible character.",
    ]);
});

test("resolveFooterConfig rejects unknown config keys", () => {
    const loaded = resolveFooterConfig([
        {
            label: "global settings",
            settings: {
                seperator: "/",
            },
        },
    ]);

    assert.equal(loaded.config.separator, "|");
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0] ?? "", /global settings is invalid:/);
    assert.match(loaded.errors[0] ?? "", /additional properties/);
});
