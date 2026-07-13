import assert from "node:assert/strict";
import { test } from "vitest";

import {
    applyModesPatch,
    computeModesPatch,
    ensureDefaultModeEntries,
    findModeForModel,
    shouldApplyDefaultModel,
} from "../src/mode-state.ts";
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

test("computeModesPatch returns null when there are no persisted changes", () => {
    const base = baseModesFile();
    const next = baseModesFile();

    assert.equal(computeModesPatch(base, next, true), null);
});

test("computeModesPatch records additions, deletions, removals, and current mode changes", () => {
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

test("computeModesPatch records changes to the persistent default model", () => {
    const base = baseModesFile();
    const next = baseModesFile();
    next.defaultModel = {
        provider: "openai-codex",
        modelId: "gpt-5.6-luna",
        thinkingLevel: "xhigh",
    };

    assert.deepEqual(computeModesPatch(base, next, false), {
        defaultModel: next.defaultModel,
    });

    applyModesPatch(base, { defaultModel: next.defaultModel });
    assert.deepEqual(base.defaultModel, next.defaultModel);
});

test("computeModesPatch can omit current mode so runtime-only switches are not written", () => {
    const base = baseModesFile();
    const next = baseModesFile();
    next.currentMode = "docs";

    assert.equal(computeModesPatch(base, next, false), null);
});

test("findModeForModel ignores thinking level when matching the active model", () => {
    const modes = {
        luna: {
            provider: "openai-codex",
            modelId: "gpt-5.6-luna",
            thinkingLevel: "xhigh" as const,
        },
        terra: {
            provider: "openai-codex",
            modelId: "gpt-5.6-terra",
        },
        sol: {
            provider: "openai-codex",
            modelId: "gpt-5.6-sol",
            thinkingLevel: "medium" as const,
        },
    };

    assert.equal(findModeForModel(modes, "openai-codex", "gpt-5.6-sol"), "sol");
});

test("ensureDefaultModeEntries preserves an explicit mode order", () => {
    const file: ModesFile = {
        version: 1,
        currentMode: "luna",
        modes: {
            luna: { provider: "openai-codex", modelId: "gpt-5.6-luna" },
            terra: { provider: "openai-codex", modelId: "gpt-5.6-terra" },
            sol: { provider: "openai-codex", modelId: "gpt-5.6-sol" },
        },
    };

    ensureDefaultModeEntries(file, {
        provider: "openai-codex",
        modelId: "gpt-5.6-terra",
        thinkingLevel: "xhigh",
    });

    assert.deepEqual(Object.keys(file.modes), ["luna", "terra", "sol"]);
});

test("shouldApplyDefaultModel recognizes Pi's initial fresh-session entries", () => {
    assert.equal(
        shouldApplyDefaultModel({ reason: "startup" }, [
            { type: "model_change" },
            { type: "thinking_level_change" },
        ]),
        true,
    );
    assert.equal(shouldApplyDefaultModel({ reason: "new" }, []), true);
});

test("shouldApplyDefaultModel preserves existing session model selections", () => {
    assert.equal(
        shouldApplyDefaultModel({ reason: "startup" }, [
            { type: "model_change" },
            { type: "thinking_level_change" },
            { type: "message" },
        ]),
        false,
    );
    assert.equal(
        shouldApplyDefaultModel({ reason: "startup" }, [
            { type: "model_change" },
            { type: "thinking_level_change" },
            { type: "model_change" },
            { type: "thinking_level_change" },
        ]),
        false,
    );
    assert.equal(shouldApplyDefaultModel({ reason: "resume" }, []), false);
});

test("applyModesPatch merges into the latest file without deleting unrelated modes", () => {
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
