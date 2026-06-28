import assert from "node:assert/strict";
import test from "node:test";

import { Container, TUI, type Component, type Terminal } from "@earendil-works/pi-tui";
import { markFooterComponent } from "../src/footer-component.ts";
import { installFooterShrinkPaddingPatch } from "../src/tui-footer-shrink-padding.ts";

const ANSI_ESCAPE_PATTERN = "\\u001b";
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

type TuiInternals = {
    doRender(): void;
    previousLines: string[];
    previousViewportTop: number;
};

function stripTestAnsi(text: string): string {
    return text.split(`${ESC}[0m`).join("").split(`${ESC}]8;;${BEL}`).join("");
}

class FakeTerminal implements Terminal {
    columns = 30;
    rows = 10;
    writes: string[] = [];

    get kittyProtocolActive(): boolean {
        return false;
    }

    start(): void {}

    stop(): void {}

    async drainInput(): Promise<void> {}

    write(data: string): void {
        this.writes.push(data);
    }

    moveBy(): void {}

    hideCursor(): void {
        this.write("\u001b[?25l");
    }

    showCursor(): void {
        this.write("\u001b[?25h");
    }

    clearLine(): void {
        this.write("\u001b[K");
    }

    clearFromCursor(): void {
        this.write("\u001b[J");
    }

    clearScreen(): void {
        this.write("\u001b[2J\u001b[H");
    }

    setTitle(): void {}

    setProgress(): void {}
}

class VariableLines implements Component {
    lineCount: number;

    constructor(lineCount: number) {
        this.lineCount = lineCount;
    }

    render(): string[] {
        return Array.from({ length: this.lineCount }, (_value, index) => {
            return `line ${index.toString().padStart(2, "0")}`;
        });
    }

    invalidate(): void {}
}

class TestEditor implements Component {
    focused = false;

    render(): string[] {
        return ["EDITOR TOP", "EDITOR BODY", "EDITOR BOTTOM"];
    }

    invalidate(): void {}
}

class TestFooter implements Component {
    render(): string[] {
        return ["FOOTER"];
    }

    invalidate(): void {}
}

void test("footer shrink padding preserves visible tail without native clear", () => {
    installFooterShrinkPaddingPatch();

    const terminal = new FakeTerminal();
    const lines = new VariableLines(24);
    const tui = new TUI(terminal);
    tui.setClearOnShrink(true);
    const tuiInternals = tui as unknown as TuiInternals;
    tui.addChild(lines);
    tui.addChild(markFooterComponent(new TestFooter(), "live"));

    tuiInternals.doRender();
    terminal.writes = [];

    lines.lineCount = 13;
    tuiInternals.doRender();

    const output = terminal.writes.join("");
    const visibleTopLine = stripTestAnsi(
        tuiInternals.previousLines[tuiInternals.previousViewportTop] ?? "",
    );
    const lineBeforeFooter = stripTestAnsi(tuiInternals.previousLines.at(-2) ?? "");
    const footerLine = stripTestAnsi(tuiInternals.previousLines.at(-1) ?? "");

    assert.equal(tuiInternals.previousLines.length, 25);
    assert.equal(visibleTopLine, "line 04");
    assert.equal(lineBeforeFooter, "line 12");
    assert.equal(footerLine.includes("FOOTER"), true);
    assert.doesNotMatch(output, new RegExp(`${ANSI_ESCAPE_PATTERN}\\[2J`));
});

void test("footer shrink padding keeps small-shrink blanks below numbered content", () => {
    installFooterShrinkPaddingPatch();

    const terminal = new FakeTerminal();
    const lines = new VariableLines(24);
    const tui = new TUI(terminal);
    tui.setClearOnShrink(true);
    const tuiInternals = tui as unknown as TuiInternals;
    tui.addChild(lines);
    tui.addChild(markFooterComponent(new TestFooter(), "live"));

    tuiInternals.doRender();
    terminal.writes = [];

    lines.lineCount = 22;
    tuiInternals.doRender();

    const output = terminal.writes.join("");
    const visibleLines = tuiInternals.previousLines
        .slice(tuiInternals.previousViewportTop)
        .map(stripTestAnsi);

    assert.equal(tuiInternals.previousLines.length, 25);
    assert.deepEqual(visibleLines.slice(0, 3), ["line 15", "line 16", "line 17"]);
    assert.equal(visibleLines[6], "line 21");
    assert.deepEqual(visibleLines.slice(7, 9), ["", ""]);
    assert.equal(visibleLines.at(-1)?.includes("FOOTER"), true);
    assert.doesNotMatch(output, new RegExp(`${ANSI_ESCAPE_PATTERN}\\[2J`));
});

void test("footer shrink padding keeps focused editor attached to footer", () => {
    installFooterShrinkPaddingPatch();

    const terminal = new FakeTerminal();
    const lines = new VariableLines(24);
    const editorContainer = new Container();
    const editor = new TestEditor();
    const belowWidgetContainer = new Container();
    const tui = new TUI(terminal);
    tui.setClearOnShrink(true);
    const tuiInternals = tui as unknown as TuiInternals;

    editorContainer.addChild(editor);
    tui.addChild(lines);
    tui.addChild(editorContainer);
    tui.addChild(belowWidgetContainer);
    tui.addChild(markFooterComponent(new TestFooter(), "live"));
    tui.setFocus(editor);

    tuiInternals.doRender();
    terminal.writes = [];

    lines.lineCount = 21;
    tuiInternals.doRender();

    const output = terminal.writes.join("");
    const visibleLines = tuiInternals.previousLines
        .slice(tuiInternals.previousViewportTop)
        .map(stripTestAnsi);

    assert.equal(tuiInternals.previousLines.length, 28);
    assert.deepEqual(visibleLines.slice(-4), [
        "EDITOR TOP",
        "EDITOR BODY",
        "EDITOR BOTTOM",
        "FOOTER",
    ]);
    assert.doesNotMatch(output, new RegExp(`${ANSI_ESCAPE_PATTERN}\\[2J`));
});
