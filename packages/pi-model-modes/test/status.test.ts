import assert from "node:assert/strict";
import { test } from "vitest";

import { applyThinkingLevelStatusPatch } from "../src/status.ts";

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
});
