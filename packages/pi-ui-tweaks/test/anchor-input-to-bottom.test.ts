import assert from "node:assert/strict";
import { test } from "vitest";

import { Container, TUI, type Component, type Terminal } from "@earendil-works/pi-tui";
import {
    installAnchorInputToBottomPatch,
    setAnchorInputToBottom,
} from "../src/anchor-input-to-bottom.ts";

class FakeTerminal implements Terminal {
    columns = 30;
    rows = 10;

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

class FixedLines implements Component {
    private readonly lines: string[];

    constructor(lines: string[]) {
        this.lines = lines;
    }

    render(): string[] {
        return this.lines;
    }

    invalidate(): void {}
}

class TestEditor implements Component {
    render(): string[] {
        return ["EDITOR TOP", "EDITOR BODY", "EDITOR BOTTOM"];
    }

    invalidate(): void {}
}

test("anchor input to bottom pads short screens above focused bottom chrome", () => {
    installAnchorInputToBottomPatch();
    setAnchorInputToBottom(true);

    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const editorContainer = new Container();
    const editor = new TestEditor();

    editorContainer.addChild(editor);
    tui.addChild(new FixedLines(["message"]));
    tui.addChild(new FixedLines(["", "⠴ Working... (4s)"]));
    tui.addChild(new FixedLines([""]));
    tui.addChild(editorContainer);
    tui.addChild(new FixedLines(["FOOTER"]));
    tui.setFocus(editor);

    assert.deepEqual(tui.render(30), [
        "message",
        "",
        "",
        "",
        "",
        "⠴ Working... (4s)",
        "EDITOR TOP",
        "EDITOR BODY",
        "EDITOR BOTTOM",
        "FOOTER",
    ]);

    setAnchorInputToBottom(false);
});

test("anchor input to bottom leaves short screens unchanged when disabled", () => {
    installAnchorInputToBottomPatch();
    setAnchorInputToBottom(false);

    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const editor = new TestEditor();

    tui.addChild(new FixedLines(["message"]));
    tui.addChild(editor);
    tui.setFocus(editor);

    assert.deepEqual(tui.render(30), ["message", "EDITOR TOP", "EDITOR BODY", "EDITOR BOTTOM"]);
});

test("anchor input to bottom leaves full-height screens unchanged", () => {
    installAnchorInputToBottomPatch();
    setAnchorInputToBottom(true);

    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const editor = new TestEditor();

    tui.addChild(new FixedLines(Array.from({ length: 8 }, (_value, index) => `line ${index}`)));
    tui.addChild(editor);
    tui.setFocus(editor);

    assert.deepEqual(tui.render(30), [
        "line 0",
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "EDITOR TOP",
        "EDITOR BODY",
        "EDITOR BOTTOM",
    ]);

    setAnchorInputToBottom(false);
});

test("anchor input to bottom compacts full-height working loader spacing", () => {
    installAnchorInputToBottomPatch();
    setAnchorInputToBottom(true);

    const terminal = new FakeTerminal();
    const tui = new TUI(terminal);
    const editorContainer = new Container();
    const editor = new TestEditor();

    editorContainer.addChild(editor);
    tui.addChild(new FixedLines(Array.from({ length: 4 }, (_value, index) => `line ${index}`)));
    tui.addChild(new FixedLines(["", "⠴ Working... (4s)"]));
    tui.addChild(new FixedLines([""]));
    tui.addChild(editorContainer);
    tui.addChild(new FixedLines(["FOOTER"]));
    tui.setFocus(editor);

    assert.deepEqual(tui.render(30), [
        "line 0",
        "line 1",
        "line 2",
        "line 3",
        "",
        "⠴ Working... (4s)",
        "EDITOR TOP",
        "EDITOR BODY",
        "EDITOR BOTTOM",
        "FOOTER",
    ]);

    setAnchorInputToBottom(false);
});
