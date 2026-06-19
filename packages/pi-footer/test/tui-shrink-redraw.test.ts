import assert from "node:assert/strict";
import test from "node:test";

import { TUI, type Component, type Terminal } from "@earendil-works/pi-tui";

import { patchTuiShrinkRedraw } from "../src/tui-shrink-redraw.ts";

class FakeTerminal implements Terminal {
    writes: string[] = [];
    private readonly width: number;
    private readonly height: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    get columns(): number {
        return this.width;
    }

    get rows(): number {
        return this.height;
    }

    get kittyProtocolActive(): boolean {
        return false;
    }

    start(_onInput: (data: string) => void, _onResize: () => void): void {}

    stop(): void {}

    drainInput(): Promise<void> {
        return Promise.resolve();
    }

    write(data: string): void {
        this.writes.push(data);
    }

    moveBy(_lines: number): void {}

    hideCursor(): void {}

    showCursor(): void {}

    clearLine(): void {}

    clearFromCursor(): void {}

    clearScreen(): void {}

    setTitle(_title: string): void {}

    setProgress(_active: boolean): void {}
}

class LinesComponent implements Component {
    private lines: string[];

    constructor(lines: string[]) {
        this.lines = lines;
    }

    setLines(lines: string[]): void {
        this.lines = lines;
    }

    render(_width: number): string[] {
        return this.lines;
    }

    invalidate(): void {}
}

type TuiRenderInternals = {
    doRender(): void;
};

function renderNow(tui: TUI): void {
    const internals = tui as unknown as TuiRenderInternals;
    internals.doRender();
}

function wroteFullClear(terminal: FakeTerminal): boolean {
    return terminal.writes.some((write) => write.includes("\x1b[2J"));
}

function waitForForcedRender(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

void test("patchTuiShrinkRedraw re-anchors scrolled content after a shrink", async () => {
    patchTuiShrinkRedraw();

    const terminal = new FakeTerminal(20, 3);
    const tui = new TUI(terminal, false);
    const lines = new LinesComponent(["one", "two", "three", "four"]);
    tui.addChild(lines);

    renderNow(tui);
    terminal.writes = [];

    lines.setLines(["one", "two", "three"]);
    renderNow(tui);
    await waitForForcedRender();

    assert.equal(wroteFullClear(terminal), true);
});

void test("patchTuiShrinkRedraw leaves unscrolled shrink rendering alone", async () => {
    patchTuiShrinkRedraw();

    const terminal = new FakeTerminal(20, 10);
    const tui = new TUI(terminal, false);
    const lines = new LinesComponent(["one", "two", "three"]);
    tui.addChild(lines);

    renderNow(tui);
    terminal.writes = [];

    lines.setLines(["one", "two"]);
    renderNow(tui);
    await waitForForcedRender();

    assert.equal(wroteFullClear(terminal), false);
});
