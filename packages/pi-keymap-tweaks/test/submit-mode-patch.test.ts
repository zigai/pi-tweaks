import assert from "node:assert/strict";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import { test } from "vitest";

import { applySubmitModeKeymap } from "../src/submit-mode-patch.ts";

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor): void {
    if (!Reflect.defineProperty(target, key, descriptor)) {
        throw new TypeError(`Unable to restore ${String(key)}`);
    }
}

test("submit-mode patches transform input once and restore both predecessors", () => {
    const agentPrototype: object = AgentSession.prototype;
    const editorPrototype: object = Editor.prototype;
    const promptDescriptor = Object.getOwnPropertyDescriptor(agentPrototype, "prompt");
    const handleInputDescriptor = Object.getOwnPropertyDescriptor(editorPrototype, "handleInput");
    if (promptDescriptor === undefined || handleInputDescriptor === undefined) {
        assert.fail("Expected patchable Pi prompt and editor methods");
    }

    let receivedOptions: unknown;
    const receivedInput: string[] = [];
    const prompt = (_text: string, options: unknown): undefined => {
        receivedOptions = options;
        return undefined;
    };
    const handleInput = (data: string): void => {
        receivedInput.push(data);
    };
    const previousTmux = process.env.TMUX;
    let handle: { dispose(): void } | undefined;
    try {
        process.env.TMUX = "test";
        Reflect.defineProperty(agentPrototype, "prompt", {
            ...promptDescriptor,
            value: prompt,
        });
        Reflect.defineProperty(editorPrototype, "handleInput", {
            ...handleInputDescriptor,
            value: handleInput,
        });

        handle = applySubmitModeKeymap();
        const patchedPrompt: unknown = Reflect.get(agentPrototype, "prompt");
        const patchedHandleInput: unknown = Reflect.get(editorPrototype, "handleInput");
        if (typeof patchedPrompt !== "function" || typeof patchedHandleInput !== "function") {
            assert.fail("Expected installed submit-mode methods");
        }
        Reflect.apply(patchedPrompt, {}, ["hello", { streamingBehavior: "steer" }]);
        Reflect.apply(patchedHandleInput, {}, ["\n"]);

        assert.deepEqual(receivedOptions, { streamingBehavior: "followUp" });
        assert.deepEqual(receivedInput, ["\r"]);
        assert.equal(applySubmitModeKeymap(), handle);
        handle.dispose();
        handle.dispose();
        assert.equal(Reflect.get(agentPrototype, "prompt"), prompt);
        assert.equal(Reflect.get(editorPrototype, "handleInput"), handleInput);
    } finally {
        handle?.dispose();
        restoreProperty(agentPrototype, "prompt", promptDescriptor);
        restoreProperty(editorPrototype, "handleInput", handleInputDescriptor);
        if (previousTmux === undefined) delete process.env.TMUX;
        else process.env.TMUX = previousTmux;
    }
});
