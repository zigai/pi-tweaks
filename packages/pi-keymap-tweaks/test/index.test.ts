import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { TUI, type EditorComponent, type EditorTheme, type Terminal } from "@earendil-works/pi-tui";
import { applyKeymapEditor } from "../src/index.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const CTRL_X = "\x18";

class FakeTerminal implements Terminal {
    columns = 80;
    rows = 24;

    get kittyProtocolActive(): boolean {
        return false;
    }

    start(): void {}

    stop(): void {}

    async drainInput(): Promise<void> {}

    write(): void {}

    moveBy(): void {}

    hideCursor(): void {}

    showCursor(): void {}

    clearLine(): void {}

    clearFromCursor(): void {}

    clearScreen(): void {}

    setTitle(): void {}

    setProgress(): void {}
}

type TestEditor = EditorComponent & {
    addToHistory(text: string): void;
    getCursor(): { line: number; col: number };
};

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

const identityStyle = (text: string): string => text;
const editorTheme: EditorTheme = {
    borderColor: identityStyle,
    selectList: {
        selectedPrefix: identityStyle,
        selectedText: identityStyle,
        description: identityStyle,
        scrollInfo: identityStyle,
        noMatch: identityStyle,
    },
};

const keybindings = {
    matches(data: string, action: string): boolean {
        if (action === "tui.editor.cursorUp") return data === UP;
        if (action === "app.models.clearAll") return data === CTRL_X;
        return false;
    },
} as unknown as KeybindingsManager;

type ClipboardWriter = (text: string) => Promise<void>;

function createKeymapEditor(writeClipboard?: ClipboardWriter): TestEditor {
    let editorFactory: EditorFactory | undefined;
    const context = {
        hasUI: true,
        ui: {
            getEditorComponent() {
                return editorFactory;
            },
            setEditorComponent(nextFactory: EditorFactory | undefined): void {
                editorFactory = nextFactory;
            },
        },
    } as unknown as ExtensionContext;

    applyKeymapEditor(context, { writeClipboard });

    if (editorFactory === undefined) {
        assert.fail("expected editor factory");
    }

    const tui = new TUI(new FakeTerminal());
    return editorFactory(tui, editorTheme, keybindings) as unknown as TestEditor;
}

function renderEditor(editor: TestEditor): void {
    editor.render(80);
}

test("ctrl+x copies and deletes the current line", async () => {
    const copiedLines: string[] = [];
    const editor = createKeymapEditor(async (text) => {
        copiedLines.push(text);
    });
    editor.setText("first\nsecond\nthird");
    renderEditor(editor);

    editor.handleInput(UP);
    renderEditor(editor);
    editor.handleInput(CTRL_X);
    renderEditor(editor);

    assert.equal(editor.getText(), "first\nthird");
    assert.deepEqual(editor.getCursor(), { line: 1, col: 0 });
    assert.deepEqual(copiedLines, ["second"]);
});

test("up arrow does not recall prompt history from a non-empty draft", () => {
    const editor = createKeymapEditor();
    editor.addToHistory("previous prompt");
    editor.setText("line one\nline two");
    renderEditor(editor);

    editor.handleInput(UP);
    renderEditor(editor);
    editor.handleInput(UP);
    renderEditor(editor);
    editor.handleInput(UP);
    renderEditor(editor);

    assert.equal(editor.getText(), "line one\nline two");
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
});

test("up arrow still recalls prompt history when the editor is empty", () => {
    const editor = createKeymapEditor();
    editor.addToHistory("older prompt");
    editor.addToHistory("newer prompt");
    renderEditor(editor);

    editor.handleInput(UP);
    renderEditor(editor);
    assert.equal(editor.getText(), "newer prompt");

    editor.handleInput(UP);
    renderEditor(editor);
    assert.equal(editor.getText(), "older prompt");

    editor.handleInput(DOWN);
    renderEditor(editor);
    assert.equal(editor.getText(), "newer prompt");
});
