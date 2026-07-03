import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { loadRunTimerConfig, resolveRunTimerConfig } from "../src/settings.ts";

test("loadRunTimerConfig scaffolds missing global config and schema", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = mkdtempSync(join(tmpdir(), "pi-run-timer-agent-"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-run-timer-cwd-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = join(agentDir, "pi-run-timer", "config.json");
        const schemaPath = join(agentDir, "pi-run-timer", "config.schema.json");
        const loaded = loadRunTimerConfig(cwd, false);

        assert.deepEqual(loaded.errors, []);
        assert.equal(loaded.config.rightMessages.enabled, false);
        assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
            $schema: "./config.schema.json",
            rightMessages: {
                enabled: false,
                intervalMs: 10000,
                minGap: 4,
                minScrollCycles: 1,
                scrollColumnIntervalMs: 120,
                dimmed: true,
                italic: true,
                messages: [],
            },
        });
        assert.match(await readFile(schemaPath, "utf8"), /Pi run timer config/);

        const customConfig = JSON.stringify({ rightMessages: { messages: ["hello"] } });
        writeFileSync(configPath, customConfig, "utf8");
        writeFileSync(schemaPath, "stale schema", "utf8");
        const loadedAgain = loadRunTimerConfig(cwd, false);

        assert.deepEqual(loadedAgain.config.rightMessages.messages, ["hello"]);
        assert.equal(await readFile(configPath, "utf8"), customConfig);
        assert.match(await readFile(schemaPath, "utf8"), /Pi run timer config/);
    } finally {
        rmSync(agentDir, { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("run timer right messages default to disabled", () => {
    const loaded = resolveRunTimerConfig([]);

    assert.equal(loaded.config.rightMessages.enabled, false);
    assert.equal(loaded.config.rightMessages.dimmed, true);
    assert.equal(loaded.config.rightMessages.italic, true);
    assert.deepEqual(loaded.config.rightMessages.messages, []);
    assert.deepEqual(loaded.errors, []);
});

test("run timer right messages use inline configured messages", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                rightMessages: {
                    intervalMs: 5000,
                    minGap: 8,
                    minScrollCycles: 2,
                    scrollColumnIntervalMs: 80,
                    dimmed: false,
                    italic: false,
                    messages: ["Tip one", "", " Tip two "],
                },
            },
        },
    ]);

    assert.equal(loaded.config.rightMessages.enabled, true);
    assert.equal(loaded.config.rightMessages.intervalMs, 5000);
    assert.equal(loaded.config.rightMessages.minGap, 8);
    assert.equal(loaded.config.rightMessages.minScrollCycles, 2);
    assert.equal(loaded.config.rightMessages.scrollColumnIntervalMs, 80);
    assert.equal(loaded.config.rightMessages.dimmed, false);
    assert.equal(loaded.config.rightMessages.italic, false);
    assert.deepEqual(loaded.config.rightMessages.messages, ["Tip one", "Tip two"]);
});

test("run timer right messages load messages from a text file", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-run-timer-"));
    try {
        writeFileSync(
            join(directory, "tips.txt"),
            "# comments are ignored\n\nFirst file tip\n  Second file tip  \n",
            "utf8",
        );

        const loaded = resolveRunTimerConfig([
            {
                label: "global",
                baseDir: directory,
                settings: {
                    rightMessages: {
                        messages: ["Inline tip"],
                        messagesFile: "tips.txt",
                    },
                },
            },
        ]);

        assert.equal(loaded.config.rightMessages.enabled, true);
        assert.deepEqual(loaded.config.rightMessages.messages, [
            "Inline tip",
            "First file tip",
            "Second file tip",
        ]);
        assert.deepEqual(loaded.errors, []);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("run timer right messages merge sources in precedence order", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                rightMessages: {
                    intervalMs: 5000,
                    messages: ["global tip"],
                },
            },
        },
        {
            label: "project",
            baseDir: ".",
            settings: {
                rightMessages: {
                    intervalMs: 12_000,
                },
            },
        },
    ]);

    assert.equal(loaded.config.rightMessages.intervalMs, 12_000);
    assert.deepEqual(loaded.config.rightMessages.messages, ["global tip"]);
});

test("run timer right messages enabled false skips configured files", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                rightMessages: {
                    enabled: false,
                    messages: ["hidden tip"],
                    messagesFile: "missing.txt",
                },
            },
        },
    ]);

    assert.equal(loaded.config.rightMessages.enabled, false);
    assert.deepEqual(loaded.config.rightMessages.messages, []);
    assert.deepEqual(loaded.errors, []);
});

test("run timer right messages report invalid values", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                rightMessages: {
                    enabled: "yes",
                    intervalMs: 0,
                    minGap: -1,
                    minScrollCycles: 0,
                    scrollColumnIntervalMs: 0,
                    dimmed: "sometimes",
                    italic: "sure",
                    messages: ["ok", 123],
                    messagesFile: "",
                },
            },
        },
    ]);

    assert.equal(loaded.config.rightMessages.enabled, false);
    assert.deepEqual(loaded.config.rightMessages.messages, []);
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0] ?? "", /global is invalid:/);
    assert.match(loaded.errors[0] ?? "", /rightMessages/);
    assert.match(loaded.errors[0] ?? "", /messages/);
});

test("run timer right messages reject unknown config keys", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                rightMessages: {
                    mesages: ["typo"],
                },
            },
        },
    ]);

    assert.equal(loaded.config.rightMessages.enabled, false);
    assert.deepEqual(loaded.config.rightMessages.messages, []);
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0] ?? "", /global is invalid:/);
    assert.match(loaded.errors[0] ?? "", /additional properties/);
});
