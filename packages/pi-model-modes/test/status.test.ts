import assert from "node:assert/strict";
import { test } from "vitest";

import { applyThinkingLevelStatusPatch, restoreThinkingLevelStatusPatch } from "../src/status.ts";

type TestInteractiveModePrototype = {
    showStatus(message: string): void;
};

test("thinking level status patch uses latest settings reader after reinstall", async () => {
    const messages: string[] = [];
    const prototype: TestInteractiveModePrototype = {
        showStatus(message: string): void {
            messages.push(message);
        },
    };
    const module = {
        InteractiveMode: {
            prototype,
        },
    };

    await applyThinkingLevelStatusPatch({
        async loadInteractiveModeModule() {
            return module;
        },
        shouldShowThinkingLevelStatus() {
            return false;
        },
    });

    prototype.showStatus("Thinking level: high");
    assert.deepEqual(messages, []);

    await applyThinkingLevelStatusPatch({
        async loadInteractiveModeModule() {
            return module;
        },
        shouldShowThinkingLevelStatus() {
            return true;
        },
    });

    prototype.showStatus("Thinking level: high");
    assert.deepEqual(messages, ["Thinking level: high"]);
    restoreThinkingLevelStatusPatch();
});

test("thinking level status patch replaces malformed shared state", async () => {
    const stateKey = Symbol.for("zigai.pi-model-modes.thinking-status-state");
    Reflect.set(globalThis, stateKey, {
        shouldShowThinkingLevelStatus() {
            return true;
        },
        patch: {
            prototype: null,
            originalShowStatus: "not callable",
            patchedShowStatus: undefined,
        },
    });
    const messages: string[] = [];
    const prototype: TestInteractiveModePrototype = {
        showStatus(message: string) {
            messages.push(message);
        },
    };

    try {
        await applyThinkingLevelStatusPatch({
            async loadInteractiveModeModule() {
                return { InteractiveMode: { prototype } };
            },
            shouldShowThinkingLevelStatus() {
                return true;
            },
        });

        prototype.showStatus("Thinking level: medium");
        assert.deepEqual(messages, ["Thinking level: medium"]);
    } finally {
        restoreThinkingLevelStatusPatch();
        Reflect.deleteProperty(globalThis, stateKey);
    }
});
