import { TUI, type Terminal } from "@earendil-works/pi-tui";

const SHRINK_VIEWPORT_PATCH_MARKER = Symbol.for("zigai.pi-footer.tui-shrink-viewport-patch");
const ESC = String.fromCharCode(0x1b);

type CursorPosition = {
    row: number;
    col: number;
};

type PatchableTuiInstance = {
    terminal: Terminal;
    previousLines: string[];
    previousViewportTop: number;
    hardwareCursorRow: number;
    overlayStack?: unknown[];
    positionHardwareCursor(cursorPos: CursorPosition | null, totalLines: number): void;
};

type PatchableTuiPrototype = {
    doRender?: (this: PatchableTuiInstance) => void;
    [SHRINK_VIEWPORT_PATCH_MARKER]?: true;
};

type PositionHardwareCursor = PatchableTuiInstance["positionHardwareCursor"];

type RenderSnapshot = {
    height: number;
    previousLineCount: number;
    previousViewportTop: number;
};

function isFiniteInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function getOverlayCount(tui: PatchableTuiInstance): number {
    if (!Array.isArray(tui.overlayStack)) return 0;
    return tui.overlayStack.length;
}

function getCurrentScreenRow(tui: PatchableTuiInstance): number {
    const currentScreenRow = tui.hardwareCursorRow - tui.previousViewportTop;
    if (currentScreenRow < 0) return 0;

    const lastScreenRow = Math.max(0, tui.terminal.rows - 1);
    if (currentScreenRow > lastScreenRow) return lastScreenRow;
    return currentScreenRow;
}

function buildViewportRevealBuffer(lines: readonly string[], currentScreenRow: number): string {
    let buffer = `${ESC}[?2026h`;

    if (currentScreenRow > 0) {
        buffer += `${ESC}[${currentScreenRow}A`;
    }
    buffer += "\r";
    buffer += `${ESC}[${lines.length}L`;

    let index = 0;
    for (const line of lines) {
        if (index > 0) {
            buffer += "\r\n";
        }
        buffer += `${ESC}[2K${line}`;
        index += 1;
    }

    buffer += `${ESC}[?2026l`;
    return buffer;
}

function maybeRevealRowsAboveShrunkViewport(
    tui: PatchableTuiInstance,
    snapshot: RenderSnapshot,
): boolean {
    if (getOverlayCount(tui) > 0) return false;
    if (!Array.isArray(tui.previousLines)) return false;

    const currentLineCount = tui.previousLines.length;
    if (snapshot.previousLineCount <= currentLineCount) return false;
    if (currentLineCount < snapshot.height) return false;
    if (!isFiniteInteger(tui.previousViewportTop)) return false;

    const desiredViewportTop = currentLineCount - snapshot.height;
    const revealCount = tui.previousViewportTop - desiredViewportTop;
    if (revealCount <= 0) return false;
    if (desiredViewportTop < 0) return false;
    if (tui.previousViewportTop > currentLineCount) return false;

    const revealedLines = tui.previousLines.slice(desiredViewportTop, tui.previousViewportTop);
    if (revealedLines.length === 0) return false;

    const currentScreenRow = getCurrentScreenRow(tui);
    tui.terminal.write(buildViewportRevealBuffer(revealedLines, currentScreenRow));
    tui.previousViewportTop = desiredViewportTop;
    tui.hardwareCursorRow = desiredViewportTop + revealedLines.length - 1;

    return true;
}

export function installSmoothShrinkViewportPatch(): void {
    // On shrink, insert newly visible rows above the viewport instead of clearing.
    const prototype = TUI.prototype as unknown as PatchableTuiPrototype;
    if (prototype[SHRINK_VIEWPORT_PATCH_MARKER] === true) return;

    const originalDoRender = prototype.doRender;
    if (typeof originalDoRender !== "function") return;

    prototype.doRender = function patchedDoRender(this: PatchableTuiInstance): void {
        const snapshot: RenderSnapshot = {
            height: this.terminal.rows,
            previousLineCount: this.previousLines.length,
            previousViewportTop: this.previousViewportTop,
        };

        const originalPositionHardwareCursor = Reflect.get(
            this,
            "positionHardwareCursor",
        ) as PositionHardwareCursor;
        let latestCursorPos: CursorPosition | null = null;
        let latestCursorTotalLines = 0;

        this.positionHardwareCursor = function recordCursorPosition(
            cursorPos: CursorPosition | null,
            totalLines: number,
        ): void {
            latestCursorPos = cursorPos;
            latestCursorTotalLines = totalLines;
            originalPositionHardwareCursor.call(this, cursorPos, totalLines);
        };

        try {
            originalDoRender.call(this);
        } finally {
            this.positionHardwareCursor = originalPositionHardwareCursor;
        }

        if (!isFiniteInteger(snapshot.height)) return;
        if (!isFiniteInteger(snapshot.previousLineCount)) return;
        if (!isFiniteInteger(snapshot.previousViewportTop)) return;

        if (maybeRevealRowsAboveShrunkViewport(this, snapshot)) {
            originalPositionHardwareCursor.call(this, latestCursorPos, latestCursorTotalLines);
        }
    };

    prototype[SHRINK_VIEWPORT_PATCH_MARKER] = true;
}
