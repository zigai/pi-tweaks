import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { TUI, visibleWidth } from "@earendil-works/pi-tui";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RENDER_TRACE_PATCHED = Symbol.for("zigai.pi-ui-tweaks.render-trace-patched");
const TRACE_FLUSH_DELAY_MS = 5_000;
const MAX_RECORDED_OPERATIONS = 500;
const RETAINED_LEADING_OPERATIONS = 50;
const TRACE_VERSION = 1;

export const RENDER_TRACE_ENV = "PI_UI_TWEAKS_RENDER_TRACE";
export const RENDER_TRACE_FILE_ENV = "PI_UI_TWEAKS_RENDER_TRACE_FILE";

type RenderTraceMarker = "autocomplete-close-detected" | "autocomplete-force-render-requested";

type RenderTraceState = {
    readonly cursorRow?: number;
    readonly fullRedrawCount?: number;
    readonly hardwareCursorRow?: number;
    readonly hasRenderTimer: boolean;
    readonly maxLinesRendered?: number;
    readonly overlayCount?: number;
    readonly previousHeight?: number;
    readonly previousLinesLength?: number;
    readonly previousViewportTop?: number;
    readonly previousWidth?: number;
    readonly renderRequested?: boolean;
};

type RenderLineSummary = {
    readonly blank: boolean;
    readonly index: number;
    readonly osc133: readonly string[];
    readonly sgr: Readonly<Record<string, number>>;
    readonly visibleWidth: number;
};

type TerminalOperation =
    | { readonly operation: "carriage-return" }
    | { readonly operation: "line-feed" }
    | { readonly operation: "csi"; readonly command: string; readonly parameters: string }
    | { readonly operation: "omitted"; readonly count: number };

type TerminalWriteSummary = {
    readonly bytes: number;
    readonly controlSequenceCounts: Readonly<Record<string, number>>;
    readonly nonWhitespaceCharacters: number;
    readonly operations: readonly TerminalOperation[];
    readonly whitespaceCharacters: number;
};

type RenderTraceEventBody =
    | {
          readonly type: "request-render";
          readonly force: boolean;
          readonly phase: "before" | "after";
          readonly state: RenderTraceState;
      }
    | {
          readonly type: "do-render";
          readonly phase: "start" | "end";
          readonly renderId: number;
          readonly state: RenderTraceState;
          readonly outcome?: "returned" | "threw";
      }
    | {
          readonly type: "render-frame";
          readonly renderId?: number;
          readonly state: RenderTraceState;
          readonly totalLines: number;
          readonly viewportStart: number;
          readonly width: number;
          readonly lines: readonly RenderLineSummary[];
      }
    | {
          readonly type: "terminal-write";
          readonly renderId: number;
          readonly write: TerminalWriteSummary;
      }
    | {
          readonly type: "marker";
          readonly marker: RenderTraceMarker;
          readonly state?: RenderTraceState;
      };

type RenderTraceEvent = RenderTraceEventBody & {
    readonly elapsedMs: number;
    readonly sequence: number;
    readonly timestamp: string;
};

type PatchableTerminal = {
    rows?: number;
    write(data: string): void;
};

type PatchableTuiInstance = {
    cursorRow?: number;
    fullRedrawCount?: number;
    hardwareCursorRow?: number;
    maxLinesRendered?: number;
    overlayStack?: unknown[];
    previousHeight?: number;
    previousLines?: unknown[];
    previousViewportTop?: number;
    previousWidth?: number;
    renderRequested?: boolean;
    renderTimer?: unknown;
    requestRender?(force?: boolean): void;
    terminal?: PatchableTerminal;
};

type PatchableTuiRender = (this: PatchableTuiInstance, width: number) => string[];
type PatchableTuiRequestRender = (this: PatchableTuiInstance, force?: boolean) => void;
type PatchableTuiDoRender = (this: PatchableTuiInstance) => void;

type RenderTracePatchRecord = {
    readonly recorder: RenderTraceRecorder;
    readonly originalRender: PatchableTuiRender;
    readonly originalRequestRender: PatchableTuiRequestRender;
    readonly originalDoRender: PatchableTuiDoRender;
    readonly patchedRender: PatchableTuiRender;
    readonly patchedRequestRender: PatchableTuiRequestRender;
    readonly patchedDoRender: PatchableTuiDoRender;
};

type PatchableTuiPrototype = {
    render?: PatchableTuiRender;
    requestRender?: PatchableTuiRequestRender;
    doRender?: PatchableTuiDoRender;
    [RENDER_TRACE_PATCHED]?: RenderTracePatchRecord;
};

type ValidatedTuiPrototype = PatchableTuiPrototype & {
    render: PatchableTuiRender;
    requestRender: PatchableTuiRequestRender;
    doRender: PatchableTuiDoRender;
};

export type InstallRenderTraceOptions = {
    readonly enabled?: boolean;
    readonly env?: NodeJS.ProcessEnv;
    readonly filePath?: string;
    readonly prototype?: PatchableTuiPrototype;
};

export type RenderTraceController = {
    readonly filePath: string;
    flush(): void;
    stop(): void;
};

let activeRecorder: RenderTraceRecorder | undefined;
let activeRenderId: number | undefined;

function incrementCount(counts: Record<string, number>, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1;
}

function finiteNumber(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    return value;
}

function tuiState(tui: PatchableTuiInstance): RenderTraceState {
    let overlayCount: number | undefined;
    if (Array.isArray(tui.overlayStack)) overlayCount = tui.overlayStack.length;

    let previousLinesLength: number | undefined;
    if (Array.isArray(tui.previousLines)) previousLinesLength = tui.previousLines.length;

    let renderRequested: boolean | undefined;
    if (typeof tui.renderRequested === "boolean") renderRequested = tui.renderRequested;

    return {
        cursorRow: finiteNumber(tui.cursorRow),
        fullRedrawCount: finiteNumber(tui.fullRedrawCount),
        hardwareCursorRow: finiteNumber(tui.hardwareCursorRow),
        hasRenderTimer: tui.renderTimer !== undefined,
        maxLinesRendered: finiteNumber(tui.maxLinesRendered),
        overlayCount,
        previousHeight: finiteNumber(tui.previousHeight),
        previousLinesLength,
        previousViewportTop: finiteNumber(tui.previousViewportTop),
        previousWidth: finiteNumber(tui.previousWidth),
        renderRequested,
    };
}

function findCsiEnd(value: string, start: number): number {
    for (let index = start; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) return index;
    }
    return value.length - 1;
}

function findStringSequenceEnd(value: string, start: number): number {
    for (let index = start; index < value.length; index += 1) {
        if (value.charCodeAt(index) === 0x07) return index;
        if (value[index] === "\x1b" && value[index + 1] === "\\") return index + 1;
    }
    return value.length - 1;
}

function parseOsc133(value: string): string | undefined {
    if (!value.startsWith("133;")) return undefined;
    const action = value.slice(4).split(";", 1)[0];
    if (action === undefined || action.length === 0) return undefined;
    return action;
}

function summarizeLine(line: string, index: number): RenderLineSummary {
    const sgr: Record<string, number> = {};
    const osc133: string[] = [];
    let hasNonWhitespace = false;

    for (let offset = 0; offset < line.length; offset += 1) {
        const character = line[offset];
        if (character !== "\x1b") {
            if (character !== undefined && character.trim().length > 0) {
                hasNonWhitespace = true;
            }
            continue;
        }

        const introducer = line[offset + 1];
        if (introducer === "[") {
            const end = findCsiEnd(line, offset + 2);
            if (line[end] === "m") {
                incrementCount(sgr, line.slice(offset + 2, end) || "0");
            }
            offset = end;
            continue;
        }

        if (introducer === "]") {
            const end = findStringSequenceEnd(line, offset + 2);
            let contentEnd = end;
            if (line[end - 1] === "\x1b" && line[end] === "\\") {
                contentEnd = end - 1;
            }
            const action = parseOsc133(line.slice(offset + 2, contentEnd));
            if (action !== undefined) osc133.push(action);
            offset = end;
            continue;
        }

        offset += 1;
    }

    return {
        blank: !hasNonWhitespace,
        index,
        osc133,
        sgr,
        visibleWidth: visibleWidth(line),
    };
}

function recordOperation(operations: TerminalOperation[], operation: TerminalOperation): void {
    operations.push(operation);
}

function boundedOperations(operations: readonly TerminalOperation[]): TerminalOperation[] {
    if (operations.length <= MAX_RECORDED_OPERATIONS) return [...operations];

    const trailingCount = MAX_RECORDED_OPERATIONS - RETAINED_LEADING_OPERATIONS - 1;
    const omittedCount = operations.length - RETAINED_LEADING_OPERATIONS - trailingCount;
    return [
        ...operations.slice(0, RETAINED_LEADING_OPERATIONS),
        { operation: "omitted", count: omittedCount },
        ...operations.slice(-trailingCount),
    ];
}

function summarizeTerminalWrite(value: string): TerminalWriteSummary {
    const controlSequenceCounts: Record<string, number> = {};
    const operations: TerminalOperation[] = [];
    let nonWhitespaceCharacters = 0;
    let whitespaceCharacters = 0;

    for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (character === "\r") {
            recordOperation(operations, { operation: "carriage-return" });
            continue;
        }
        if (character === "\n") {
            recordOperation(operations, { operation: "line-feed" });
            continue;
        }
        if (character !== "\x1b") {
            if (character?.trim().length === 0) {
                whitespaceCharacters += 1;
            } else {
                nonWhitespaceCharacters += 1;
            }
            continue;
        }

        const introducer = value[offset + 1];
        if (introducer === "[") {
            const end = findCsiEnd(value, offset + 2);
            const command = value[end] ?? "unknown";
            const parameters = value.slice(offset + 2, end);
            let countKey = `csi:${command}`;
            if (command === "m") countKey = `sgr:${parameters || "0"}`;
            incrementCount(controlSequenceCounts, countKey);
            if ("ABCDEFGHJKf".includes(command)) {
                recordOperation(operations, { operation: "csi", command, parameters });
            }
            offset = end;
            continue;
        }

        if (introducer === "]") {
            const end = findStringSequenceEnd(value, offset + 2);
            let contentEnd = end;
            if (value[end - 1] === "\x1b" && value[end] === "\\") {
                contentEnd = end - 1;
            }
            const content = value.slice(offset + 2, contentEnd);
            const command = content.split(";", 1)[0] || "unknown";
            const osc133 = parseOsc133(content);
            if (osc133 === undefined) {
                incrementCount(controlSequenceCounts, `osc:${command}`);
            } else {
                incrementCount(controlSequenceCounts, `osc:133:${osc133}`);
            }
            offset = end;
            continue;
        }

        if (introducer === "P" || introducer === "X" || introducer === "^" || introducer === "_") {
            const end = findStringSequenceEnd(value, offset + 2);
            incrementCount(controlSequenceCounts, `string:${introducer}`);
            offset = end;
            continue;
        }

        incrementCount(controlSequenceCounts, `escape:${introducer ?? "unknown"}`);
        offset += 1;
    }

    return {
        bytes: Buffer.byteLength(value),
        controlSequenceCounts,
        nonWhitespaceCharacters,
        operations: boundedOperations(operations),
        whitespaceCharacters,
    };
}

class RenderTraceRecorder {
    readonly filePath: string;
    private readonly startedAt = performance.now();
    private sequence = 0;
    private pending: RenderTraceEvent[] = [];
    private flushTimer: NodeJS.Timeout | undefined;
    private stopped = false;

    constructor(filePath: string) {
        this.filePath = filePath;
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(
            filePath,
            `${JSON.stringify({ type: "trace-start", version: TRACE_VERSION, pid: process.pid, timestamp: new Date().toISOString() })}\n`,
            "utf8",
        );
    }

    record(body: RenderTraceEventBody): void {
        if (this.stopped) return;
        this.sequence += 1;
        this.pending.push({
            ...body,
            elapsedMs: Math.round((performance.now() - this.startedAt) * 1_000) / 1_000,
            sequence: this.sequence,
            timestamp: new Date().toISOString(),
        });
        this.scheduleFlush();
    }

    flush(): void {
        if (this.flushTimer !== undefined) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        if (this.pending.length === 0) return;

        const events = this.pending;
        this.pending = [];
        try {
            appendFileSync(
                this.filePath,
                `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
            );
        } catch {
            this.stopped = true;
            console.warn(`[pi-ui-tweaks] render trace write failed at ${this.filePath}`);
        }
    }

    stop(): void {
        if (this.stopped) return;
        this.flush();
        this.stopped = true;
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== undefined) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.flush();
        }, TRACE_FLUSH_DELAY_MS);
        this.flushTimer.unref();
    }
}

function traceEnabled(env: NodeJS.ProcessEnv): boolean {
    return env[RENDER_TRACE_ENV] === "1";
}

function defaultTracePath(env: NodeJS.ProcessEnv): string {
    const configuredPath = env[RENDER_TRACE_FILE_ENV]?.trim();
    if (configuredPath !== undefined && configuredPath.length > 0) {
        return resolve(configuredPath);
    }
    return join(getAgentDir(), "pi-ui-tweaks", `render-trace-${process.pid}.jsonl`);
}

function isValidatedTuiPrototype(value: unknown): value is ValidatedTuiPrototype {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return false;
    }
    return (
        typeof Reflect.get(value, "render") === "function" &&
        typeof Reflect.get(value, "requestRender") === "function" &&
        typeof Reflect.get(value, "doRender") === "function"
    );
}

function visibleFrameLines(
    tui: PatchableTuiInstance,
    lines: readonly string[],
): {
    viewportStart: number;
    lines: readonly RenderLineSummary[];
} {
    const rawRows = tui.terminal?.rows;
    let rows = lines.length;
    if (typeof rawRows === "number" && Number.isFinite(rawRows) && rawRows > 0) {
        rows = Math.floor(rawRows);
    }
    const viewportStart = Math.max(0, lines.length - rows);
    return {
        viewportStart,
        lines: lines
            .slice(viewportStart)
            .map((line, offset) => summarizeLine(line, viewportStart + offset)),
    };
}

function restorePatch(prototype: PatchableTuiPrototype, patch: RenderTracePatchRecord): void {
    if (prototype.render === patch.patchedRender) prototype.render = patch.originalRender;
    if (prototype.requestRender === patch.patchedRequestRender) {
        prototype.requestRender = patch.originalRequestRender;
    }
    if (prototype.doRender === patch.patchedDoRender) prototype.doRender = patch.originalDoRender;
    if (prototype[RENDER_TRACE_PATCHED] === patch) prototype[RENDER_TRACE_PATCHED] = undefined;
}

/** Records a safe marker in an active render trace without serializing editor content. */
export function recordRenderTraceMarker(
    marker: RenderTraceMarker,
    tui?: PatchableTuiInstance,
): void {
    const recorder = activeRecorder;
    if (recorder === undefined) return;
    let state: RenderTraceState | undefined;
    if (tui !== undefined) state = tuiState(tui);
    recorder.record({
        type: "marker",
        marker,
        state,
    });
}

/**
 * Installs opt-in render tracing for diagnosing terminal repaint failures.
 * Trace output contains control/layout metadata only; visible text is never serialized.
 */
export function installRenderTracePatch(
    options: InstallRenderTraceOptions = {},
): RenderTraceController | undefined {
    const env = options.env ?? process.env;
    const enabled = options.enabled ?? traceEnabled(env);
    if (!enabled) return undefined;

    const prototypeValue: unknown = options.prototype ?? TUI.prototype;
    if (!isValidatedTuiPrototype(prototypeValue)) {
        console.warn("[pi-ui-tweaks] render trace unavailable; Pi TUI internals may have changed");
        return undefined;
    }
    const prototype = prototypeValue;
    const originalRender = prototype.render;
    const originalRequestRender = prototype.requestRender;
    const originalDoRender = prototype.doRender;

    const existingPatch = prototype[RENDER_TRACE_PATCHED];
    if (existingPatch !== undefined) {
        activeRecorder = existingPatch.recorder;
        return {
            filePath: existingPatch.recorder.filePath,
            flush: () => existingPatch.recorder.flush(),
            stop: () => {
                existingPatch.recorder.stop();
                restorePatch(prototype, existingPatch);
                if (activeRecorder === existingPatch.recorder) activeRecorder = undefined;
            },
        };
    }

    const filePath = options.filePath ?? defaultTracePath(env);
    let recorder: RenderTraceRecorder;
    try {
        recorder = new RenderTraceRecorder(filePath);
    } catch {
        console.warn(`[pi-ui-tweaks] failed to create render trace at ${filePath}`);
        return undefined;
    }

    let nextRenderId = 0;
    const patchedRender: PatchableTuiRender = function renderTraceRender(width) {
        const lines = originalRender.call(this, width);
        const visible = visibleFrameLines(this, lines);
        recorder.record({
            type: "render-frame",
            renderId: activeRenderId,
            state: tuiState(this),
            totalLines: lines.length,
            viewportStart: visible.viewportStart,
            width,
            lines: visible.lines,
        });
        return lines;
    };
    const patchedRequestRender: PatchableTuiRequestRender = function renderTraceRequestRender(
        force = false,
    ) {
        recorder.record({ type: "request-render", force, phase: "before", state: tuiState(this) });
        try {
            originalRequestRender.call(this, force);
        } finally {
            recorder.record({
                type: "request-render",
                force,
                phase: "after",
                state: tuiState(this),
            });
        }
    };
    const patchedDoRender: PatchableTuiDoRender = function renderTraceDoRender() {
        nextRenderId += 1;
        const renderId = nextRenderId;
        const previousActiveRenderId = activeRenderId;
        activeRenderId = renderId;
        recorder.record({
            type: "do-render",
            phase: "start",
            renderId,
            state: tuiState(this),
        });

        const terminal = this.terminal;
        let originalWrite: PatchableTerminal["write"] | undefined;
        let originalWriteOwnDescriptor: PropertyDescriptor | undefined;
        if (terminal !== undefined) {
            const originalWriteValue: unknown = Reflect.get(terminal, "write");
            if (typeof originalWriteValue === "function") {
                // SAFETY: The immediately preceding runtime guard proves the private terminal write seam is callable.
                originalWrite = originalWriteValue as PatchableTerminal["write"];
                originalWriteOwnDescriptor = Object.getOwnPropertyDescriptor(terminal, "write");
            }
        }
        let patchedWrite: PatchableTerminal["write"] | undefined;
        if (terminal !== undefined && typeof originalWrite === "function") {
            patchedWrite = function renderTraceTerminalWrite(
                this: PatchableTerminal,
                data: string,
            ): void {
                originalWrite.call(this, data);
                recorder.record({
                    type: "terminal-write",
                    renderId,
                    write: summarizeTerminalWrite(data),
                });
            };
            terminal.write = patchedWrite;
        }

        let outcome: "returned" | "threw" = "threw";
        try {
            originalDoRender.call(this);
            outcome = "returned";
        } finally {
            if (
                terminal !== undefined &&
                patchedWrite !== undefined &&
                terminal.write === patchedWrite &&
                originalWrite !== undefined
            ) {
                if (originalWriteOwnDescriptor === undefined) {
                    Reflect.deleteProperty(terminal, "write");
                } else {
                    Object.defineProperty(terminal, "write", originalWriteOwnDescriptor);
                }
            }
            recorder.record({
                type: "do-render",
                phase: "end",
                renderId,
                state: tuiState(this),
                outcome,
            });
            activeRenderId = previousActiveRenderId;
        }
    };

    const patch: RenderTracePatchRecord = {
        recorder,
        originalRender,
        originalRequestRender,
        originalDoRender,
        patchedRender,
        patchedRequestRender,
        patchedDoRender,
    };
    prototype.render = patchedRender;
    prototype.requestRender = patchedRequestRender;
    prototype.doRender = patchedDoRender;
    prototype[RENDER_TRACE_PATCHED] = patch;
    activeRecorder = recorder;

    return {
        filePath,
        flush: () => recorder.flush(),
        stop: () => {
            recorder.stop();
            restorePatch(prototype, patch);
            if (activeRecorder === recorder) activeRecorder = undefined;
        },
    };
}
