import assert from "node:assert/strict";
import test from "node:test";

import { TUI, type Component, type Terminal } from "@earendil-works/pi-tui";
import { installSmoothShrinkViewportPatch } from "../src/tui-shrink-viewport.ts";

const ANSI_ESCAPE_PATTERN = "\\u001b";

type TuiInternals = {
    doRender(): void;
    previousViewportTop: number;
};

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

class TestFooter implements Component {
    render(): string[] {
        return ["FOOTER"];
    }

    invalidate(): void {}
}

void test("smooth shrink patch bottom-aligns the viewport without a full clear", () => {
    installSmoothShrinkViewportPatch();

    const terminal = new FakeTerminal();
    const lines = new VariableLines(14);
    const tui = new TUI(terminal);
    const tuiInternals = tui as unknown as TuiInternals;
    tui.addChild(lines);
    tui.addChild(new TestFooter());

    tuiInternals.doRender();
    terminal.writes = [];

    lines.lineCount = 13;
    tuiInternals.doRender();

    const output = terminal.writes.join("");
    assert.equal(tuiInternals.previousViewportTop, 4);
    assert.match(output, new RegExp(`${ANSI_ESCAPE_PATTERN}\\[1L`));
    assert.doesNotMatch(output, new RegExp(`${ANSI_ESCAPE_PATTERN}\\[2J`));
    assert.match(output, /line 04/);
});
