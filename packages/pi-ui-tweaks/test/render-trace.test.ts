import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { installRenderTracePatch, recordRenderTraceMarker } from "../src/render-trace.ts";

type RecordingTerminal = {
    rows: number;
    writes: string[];
    write(data: string): void;
};

type FakeTui = {
    cursorRow: number;
    fullRedrawCount: number;
    hardwareCursorRow: number;
    maxLinesRendered: number;
    overlayStack: unknown[];
    previousHeight: number;
    previousLines: string[];
    previousViewportTop: number;
    previousWidth: number;
    renderRequested: boolean;
    terminal: RecordingTerminal;
    render(width: number): string[];
    requestRender(force?: boolean): void;
    doRender(): void;
};

function createFakeTuiPrototype(): FakeTui {
    return {
        cursorRow: 0,
        fullRedrawCount: 0,
        hardwareCursorRow: 0,
        maxLinesRendered: 0,
        overlayStack: [],
        previousHeight: 0,
        previousLines: [],
        previousViewportTop: 0,
        previousWidth: 0,
        renderRequested: false,
        terminal: {
            rows: 3,
            writes: [],
            write(data: string): void {
                this.writes.push(data);
            },
        },
        render(): string[] {
            return [
                "\x1b]133;A\x07\x1b[48;2;52;53;65mAPI_KEY=super-secret\x1b[0m",
                "\x1b]133;B\x07\x1b]133;C\x07",
                "footer",
            ];
        },
        requestRender(force = false): void {
            this.renderRequested = true;
            if (force) {
                this.previousLines = [];
                this.previousWidth = -1;
                this.previousHeight = -1;
            }
        },
        doRender(): void {
            const lines = this.render(40);
            this.terminal.write(`\x1b[2J\x1b[H\x1b[3J${lines.join("\r\n")}`);
            this.previousLines = lines;
            this.previousWidth = 40;
            this.previousHeight = this.terminal.rows;
            this.renderRequested = false;
        },
    };
}

test("render trace captures repaint controls without serializing visible text", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-ui-tweaks-render-trace-"));
    const filePath = join(temporaryDirectory, "trace.jsonl");
    const prototype = createFakeTuiPrototype();
    const instance = Object.assign(Object.create(prototype) as FakeTui, {
        terminal: {
            rows: 3,
            writes: [] as string[],
            write(data: string): void {
                this.writes.push(data);
            },
        },
    });

    try {
        const trace = installRenderTracePatch({ enabled: true, filePath, prototype });
        if (trace === undefined) assert.fail("expected render trace to be installed");

        instance.requestRender(true);
        recordRenderTraceMarker("autocomplete-close-detected", instance);
        instance.doRender();
        trace.flush();

        const output = readFileSync(filePath, "utf8");
        assert.doesNotMatch(output, /API_KEY|super-secret|footer/);
        assert.match(output, /"type":"request-render"/);
        assert.match(output, /"marker":"autocomplete-close-detected"/);
        assert.match(output, /"type":"render-frame"/);
        assert.match(output, /"osc133":\["A"\]/);
        assert.match(output, /"48;2;52;53;65":1/);
        assert.match(output, /"type":"terminal-write"/);
        assert.match(output, /"command":"J","parameters":"2"/);
        assert.match(output, /"command":"J","parameters":"3"/);

        trace.stop();
        assert.equal(prototype.render.name, "render");
        assert.equal(prototype.requestRender.name, "requestRender");
        assert.equal(prototype.doRender.name, "doRender");
    } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
});

test("render trace stays disabled without the opt-in environment flag", () => {
    const prototype = createFakeTuiPrototype();
    const trace = installRenderTracePatch({ env: {}, prototype });
    assert.equal(trace, undefined);
});

test("render trace preserves inherited terminal write methods", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-ui-tweaks-render-trace-"));
    const filePath = join(temporaryDirectory, "trace.jsonl");
    const prototype = createFakeTuiPrototype();
    const terminalPrototype: RecordingTerminal = {
        rows: 3,
        writes: [],
        write(data: string): void {
            this.writes.push(data);
        },
    };
    const terminal = Object.assign(Object.create(terminalPrototype) as RecordingTerminal, {
        rows: 3,
        writes: [] as string[],
    });
    const instance = Object.assign(Object.create(prototype) as FakeTui, { terminal });

    try {
        const trace = installRenderTracePatch({ enabled: true, filePath, prototype });
        if (trace === undefined) assert.fail("expected render trace to be installed");

        assert.equal(Object.hasOwn(terminal, "write"), false);
        instance.doRender();
        assert.equal(Object.hasOwn(terminal, "write"), false);
        trace.stop();
    } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
});
