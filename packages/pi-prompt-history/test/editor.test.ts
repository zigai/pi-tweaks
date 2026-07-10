import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { applyPromptHistoryEditor, type PromptHistoryLoader } from "../src/editor.ts";
import type { PromptEntry } from "../src/types.ts";

type EditorTestContext = {
    readonly ctx: ExtensionContext;
    readonly installedFactories: unknown[];
    setEditorText(text: string): void;
};

function createEditorTestContext(): EditorTestContext {
    const installedFactories: unknown[] = [];
    let editorText = "";
    const ctx = {
        cwd: "/tmp/project",
        hasUI: true,
        sessionManager: {
            getBranch() {
                return [];
            },
            getSessionFile() {
                return "/tmp/project/current.jsonl";
            },
        },
        ui: {
            getEditorComponent() {
                return undefined;
            },
            getEditorText() {
                return editorText;
            },
            setEditorComponent(factory: unknown) {
                installedFactories.push(factory);
            },
        },
    };

    return {
        // SAFETY: applyPromptHistoryEditor uses only the context members implemented above.
        ctx: ctx as unknown as ExtensionContext,
        installedFactories,
        setEditorText(text: string): void {
            editorText = text;
        },
    };
}

function deferredHistoryLoader(): {
    readonly load: PromptHistoryLoader;
    resolve(history: PromptEntry[]): void;
} {
    let resolvePromise: ((history: PromptEntry[]) => void) | undefined;
    const load: PromptHistoryLoader = () => {
        return new Promise((resolve) => {
            resolvePromise = resolve;
        });
    };
    return {
        load,
        resolve(history): void {
            if (resolvePromise === undefined) assert.fail("history load has not started");
            resolvePromise(history);
        },
    };
}

test("prompt history installs the editor once after history loading completes", async () => {
    const context = createEditorTestContext();
    const history = deferredHistoryLoader();

    const applying = applyPromptHistoryEditor(context.ctx, history.load);
    await Promise.resolve();
    assert.equal(context.installedFactories.length, 0);

    history.resolve([{ text: "previous prompt", timestamp: 1 }]);
    await applying;

    assert.equal(context.installedFactories.length, 1);
});

test("prompt history does not replace an editor changed while history loads", async () => {
    const context = createEditorTestContext();
    const history = deferredHistoryLoader();

    const applying = applyPromptHistoryEditor(context.ctx, history.load);
    context.setEditorText("user input");
    history.resolve([]);
    await applying;

    assert.equal(context.installedFactories.length, 0);
});
