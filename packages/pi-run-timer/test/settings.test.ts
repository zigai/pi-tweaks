import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveRunTimerConfig } from "../src/settings.ts";

void test("run timer right messages default to disabled", () => {
    const loaded = resolveRunTimerConfig([]);

    assert.equal(loaded.config.rightMessages.enabled, false);
    assert.equal(loaded.config.rightMessages.dimmed, true);
    assert.equal(loaded.config.rightMessages.italic, true);
    assert.deepEqual(loaded.config.rightMessages.messages, []);
    assert.deepEqual(loaded.errors, []);
});

void test("run timer right messages use inline configured messages", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                runTimer: {
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

void test("run timer right messages load messages from a text file", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "pi-run-timer-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
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
                runTimer: {
                    rightMessages: {
                        messages: ["Inline tip"],
                        messagesFile: "tips.txt",
                    },
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
});

void test("run timer right messages merge sources in precedence order", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                runTimer: {
                    rightMessages: {
                        intervalMs: 5000,
                        messages: ["global tip"],
                    },
                },
            },
        },
        {
            label: "project",
            baseDir: ".",
            settings: {
                runTimer: {
                    rightMessages: {
                        intervalMs: 12_000,
                    },
                },
            },
        },
    ]);

    assert.equal(loaded.config.rightMessages.intervalMs, 12_000);
    assert.deepEqual(loaded.config.rightMessages.messages, ["global tip"]);
});

void test("run timer right messages enabled false skips configured files", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                runTimer: {
                    rightMessages: {
                        enabled: false,
                        messages: ["hidden tip"],
                        messagesFile: "missing.txt",
                    },
                },
            },
        },
    ]);

    assert.equal(loaded.config.rightMessages.enabled, false);
    assert.deepEqual(loaded.config.rightMessages.messages, []);
    assert.deepEqual(loaded.errors, []);
});

void test("run timer right messages report invalid values", () => {
    const loaded = resolveRunTimerConfig([
        {
            label: "global",
            baseDir: ".",
            settings: {
                runTimer: {
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
        },
    ]);

    assert.equal(loaded.config.rightMessages.enabled, true);
    assert.deepEqual(loaded.config.rightMessages.messages, ["ok"]);
    assert.deepEqual(loaded.errors, [
        "global.runTimer.rightMessages.enabled must be a boolean.",
        "global.runTimer.rightMessages.intervalMs must be a positive integer.",
        "global.runTimer.rightMessages.minGap must be a non-negative integer.",
        "global.runTimer.rightMessages.minScrollCycles must be a positive integer.",
        "global.runTimer.rightMessages.scrollColumnIntervalMs must be a positive integer.",
        "global.runTimer.rightMessages.dimmed must be a boolean.",
        "global.runTimer.rightMessages.italic must be a boolean.",
        "global.runTimer.rightMessages.messages[1] must be a string.",
        "global.runTimer.rightMessages.messagesFile must be a non-empty string.",
    ]);
});
