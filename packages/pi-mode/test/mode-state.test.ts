import assert from "node:assert/strict";
import test from "node:test";

import { applyModesPatch, computeModesPatch } from "../src/mode-state.ts";
import type { ModesFile } from "../src/types.ts";

function baseModesFile(): ModesFile {
    return {
        version: 1,
        currentMode: "default",
        modes: {
            default: {
                provider: "openai",
                modelId: "gpt-5",
                thinkingLevel: "medium",
            },
            docs: {
                provider: "anthropic",
                modelId: "claude-opus",
                thinkingLevel: "high",
            },
        },
    };
}

void test("computeModesPatch returns null when there are no persisted changes", () => {
    const base = baseModesFile();
    const next = baseModesFile();

    assert.equal(computeModesPatch(base, next, true), null);
});

void test("computeModesPatch records additions, deletions, removals, and current mode changes", () => {
    const base = baseModesFile();
    const next: ModesFile = {
        version: 1,
        currentMode: "review",
        modes: {
            default: {
                provider: "openai",
                modelId: "gpt-5",
            },
            review: {
                provider: "openai",
                modelId: "o4-mini",
                thinkingLevel: "off",
            },
        },
    };

    assert.deepEqual(computeModesPatch(base, next, true), {
        currentMode: "review",
        modes: {
            default: { thinkingLevel: null },
            docs: null,
            review: {
                provider: "openai",
                modelId: "o4-mini",
                thinkingLevel: "off",
            },
        },
    });
});

void test("computeModesPatch can omit current mode so runtime-only switches are not written", () => {
    const base = baseModesFile();
    const next = baseModesFile();
    next.currentMode = "docs";

    assert.equal(computeModesPatch(base, next, false), null);
});

void test("applyModesPatch merges into the latest file without deleting unrelated modes", () => {
    const latest: ModesFile = baseModesFile();
    latest.modes.local = {
        provider: "ollama",
        modelId: "llama3",
        thinkingLevel: "off",
    };

    applyModesPatch(latest, {
        currentMode: "review",
        modes: {
            default: { thinkingLevel: null },
            docs: null,
            review: {
                provider: "openai",
                modelId: "o4-mini",
                thinkingLevel: "off",
            },
        },
    });

    assert.equal(latest.currentMode, "review");
    assert.equal(latest.modes.default?.provider, "openai");
    assert.equal(latest.modes.default?.modelId, "gpt-5");
    assert.equal(latest.modes.default?.thinkingLevel, undefined);
    assert.equal(latest.modes.docs, undefined);
    assert.deepEqual(latest.modes.local, {
        provider: "ollama",
        modelId: "llama3",
        thinkingLevel: "off",
    });
    assert.deepEqual(latest.modes.review, {
        provider: "openai",
        modelId: "o4-mini",
        thinkingLevel: "off",
    });
});
