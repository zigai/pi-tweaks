import assert from "node:assert/strict";
import { test } from "vitest";

import { applyPromptHistoryEditor, type PromptHistoryEditorContext } from "../src/editor.ts";
import type { UserMessage } from "@earendil-works/pi-ai";
import {
    CustomEditor,
    type KeybindingsManager,
    type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

type EditorFactory = NonNullable<
    Parameters<PromptHistoryEditorContext["ui"]["setEditorComponent"]>[0]
>;

type EditorTestContext = {
    readonly ctx: PromptHistoryEditorContext;
    readonly addedPrompts: string[];
    readonly installedFactories: EditorFactory[];
};

function testDouble<T extends object>(value: Partial<T>): T {
    // SAFETY: Tests supply only the members exercised by the production path under test.
    return value as T;
}

function userEntry(content: UserMessage["content"], timestamp: number): SessionEntry {
    return {
        id: `entry-${timestamp}`,
        parentId: null,
        timestamp: new Date(timestamp).toISOString(),
        type: "message",
        message: {
            role: "user",
            content,
            timestamp,
        },
    };
}

function createEditorTestContext(branch: SessionEntry[] = [], hasUI = true): EditorTestContext {
    const addedPrompts: string[] = [];
    const installedFactories: EditorFactory[] = [];
    const recordingFactory: EditorFactory = (tui, theme, keybindings) => {
        const editor = new CustomEditor(tui, theme, keybindings);
        editor.addToHistory = (text): void => {
            addedPrompts.push(text);
        };
        return editor;
    };
    const ctx = {
        hasUI,
        sessionManager: {
            getBranch() {
                return branch;
            },
        },
        ui: {
            getEditorComponent() {
                return recordingFactory;
            },
            setEditorComponent(factory: EditorFactory | undefined) {
                if (factory !== undefined) installedFactories.push(factory);
            },
        },
    };

    return {
        ctx,
        addedPrompts,
        installedFactories,
    };
}

test("prompt history preloads prompts from the current branch in branch order", () => {
    const context = createEditorTestContext([
        userEntry("older current prompt", 1),
        userEntry("newer current prompt", 2),
    ]);

    applyPromptHistoryEditor(context.ctx);
    assert.equal(context.installedFactories.length, 1);
    // SAFETY: Editor construction only reads borderColor from the theme before the recording
    // addToHistory replacement runs; no TUI or keybinding operations are exercised.
    context.installedFactories[0]?.(
        undefined as never,
        { borderColor: "" } as never,
        undefined as never,
    );
    assert.deepEqual(context.addedPrompts, ["older current prompt", "newer current prompt"]);
});

test("prompt history preserves a configured host editor and its rendering", () => {
    const addedPrompts: string[] = [];
    const hostEditor = {
        render(width: number) {
            if (width <= 0) return [];
            return ["<magic>workflowz</magic>"];
        },
        invalidate() {},
        getText() {
            return "workflowz";
        },
        setText() {},
        handleInput() {},
        addToHistory(text: string) {
            addedPrompts.push(text);
        },
    };
    let installedFactory: EditorFactory | undefined;
    const ctx: PromptHistoryEditorContext = {
        hasUI: true,
        sessionManager: {
            getBranch() {
                return [userEntry("current prompt", 1)];
            },
        },
        ui: {
            getEditorComponent() {
                return () => hostEditor;
            },
            setEditorComponent(factory) {
                installedFactory = factory;
            },
        },
    };

    applyPromptHistoryEditor(ctx);
    assert.notEqual(installedFactory, undefined);
    if (installedFactory === undefined) return;

    const editor = installedFactory(
        {
            getFocusedComponent() {
                return hostEditor;
            },
        } as never,
        undefined as never,
        undefined as never,
    );

    assert.equal(editor, hostEditor);
    assert.deepEqual(editor.render(80), ["<magic>workflowz</magic>"]);
    assert.deepEqual(addedPrompts, ["current prompt"]);
});

test("prompt history keeps Pi's default editor shortcut hook non-recursive", () => {
    let installedFactory: EditorFactory | undefined;
    const ctx: PromptHistoryEditorContext = {
        hasUI: true,
        sessionManager: {
            getBranch() {
                return [];
            },
        },
        ui: {
            getEditorComponent() {
                return undefined;
            },
            setEditorComponent(factory) {
                installedFactory = factory;
            },
        },
    };

    applyPromptHistoryEditor(ctx);
    assert.notEqual(installedFactory, undefined);
    if (installedFactory === undefined) return;

    let focusedEditor: CustomEditor;
    const testTui = testDouble<TUI>({});
    Object.assign(testTui, {
        getFocusedComponent() {
            return focusedEditor;
        },
    });
    const theme = testDouble<EditorTheme>({ borderColor: (text) => text });
    const keybindings = testDouble<KeybindingsManager>({
        matches() {
            return false;
        },
    });
    const defaultEditor = new CustomEditor(testTui, theme, keybindings);
    focusedEditor = defaultEditor;
    const editor = installedFactory(testTui, theme, keybindings);

    assert.equal(editor instanceof CustomEditor, true);
    if (!(editor instanceof CustomEditor)) return;

    // Pi 0.84.3 delegates custom-editor shortcuts to its default editor. Returning that same
    // instance makes the delegate call itself for every key pressed during startup.
    editor.onExtensionShortcut ??= (data) => defaultEditor.onExtensionShortcut?.(data) ?? false;

    assert.doesNotThrow(() => editor.onExtensionShortcut?.("/"));
    assert.notEqual(editor, defaultEditor);
});

test("prompt history does not install an editor without a UI", () => {
    const context = createEditorTestContext([], false);

    applyPromptHistoryEditor(context.ctx);

    assert.equal(context.installedFactories.length, 0);
});
