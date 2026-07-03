import { TUI, type Component } from "@earendil-works/pi-tui";

import { getFooterComponentKind } from "./footer-component.ts";

const FOOTER_SHRINK_PADDING_PATCH_MARKER = Symbol.for(
    "zigai.pi-footer.tui-footer-shrink-padding-patch",
);
const CHILD_LINE_RANGES_FRAME_KEY = Symbol.for("zigai.pi-tweaks.tui-child-line-ranges-frame");
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const TERMINAL_LINE_RESET = `${ESC}[0m${ESC}]8;;${BEL}`;
const BOTTOM_CHROME_PRECEDING_SIBLINGS = 2;

type PatchableTuiInstance = {
    [CHILD_LINE_RANGES_FRAME_KEY]?: ChildLineRangesFrame;
    children: Component[];
    focusedComponent?: Component | null;
    previousLines: string[];
    previousWidth: number;
    previousHeight: number;
    previousViewportTop: number;
    terminal: {
        columns: number;
        rows: number;
    };
};

type ComponentContainer = Component & {
    children: Component[];
};

type PatchableTuiPrototype = {
    render?: (this: PatchableTuiInstance, width: number) => string[];
    [FOOTER_SHRINK_PADDING_PATCH_MARKER]?: true;
};

type ChildLineRange = {
    index: number;
    start: number;
    end: number;
};

type ChildLineRangesFrame = {
    width: number;
    depth: number;
    ranges?: ChildLineRange[];
};

type BottomChromeSpacingResult = {
    lines: string[];
    removedRows: number;
};

function getFooterChildIndex(tui: PatchableTuiInstance): number | undefined {
    const index = tui.children.length - 1;
    const lastChild = tui.children[index];
    if (lastChild === undefined) return undefined;
    if (getFooterComponentKind(lastChild) === undefined) return undefined;
    return index;
}

function hasPiFooter(tui: PatchableTuiInstance): boolean {
    return getFooterChildIndex(tui) !== undefined;
}

function isStableTerminalSize(tui: PatchableTuiInstance): boolean {
    if (tui.previousWidth !== 0 && tui.previousWidth !== tui.terminal.columns) return false;
    if (tui.previousHeight !== 0 && tui.previousHeight !== tui.terminal.rows) return false;
    return true;
}

function stripTerminalLineReset(line: string): string {
    if (!line.endsWith(TERMINAL_LINE_RESET)) return line;
    return line.slice(0, -TERMINAL_LINE_RESET.length);
}

function getFirstChangedLineIndex(
    previousLines: readonly string[],
    lines: readonly string[],
): number | undefined {
    const maxLines = Math.max(previousLines.length, lines.length);
    for (let index = 0; index < maxLines; index += 1) {
        const previousLine = stripTerminalLineReset(previousLines[index] ?? "");
        const line = lines[index] ?? "";
        if (previousLine !== line) return index;
    }
    return undefined;
}

function hasDistantPreViewportChange(tui: PatchableTuiInstance, lines: readonly string[]): boolean {
    const firstChangedLine = getFirstChangedLineIndex(tui.previousLines, lines);
    if (firstChangedLine === undefined) return false;

    const fullRedrawBoundary = Math.max(0, tui.previousViewportTop - tui.terminal.rows);
    return firstChangedLine <= fullRedrawBoundary;
}

function shouldPadShrink(tui: PatchableTuiInstance, lines: readonly string[]): boolean {
    if (!isStableTerminalSize(tui)) return false;
    if (!hasPiFooter(tui)) return false;
    if (!Array.isArray(tui.previousLines)) return false;
    if (tui.previousLines.length <= lines.length) return false;
    if (tui.previousLines.length < tui.terminal.rows) return false;
    if (hasDistantPreViewportChange(tui, lines)) return false;
    return lines.length > 0;
}

function getPaddingInsertIndex(tui: PatchableTuiInstance, targetLength: number): number {
    if (tui.previousViewportTop <= 0) return 0;
    return Math.min(tui.previousViewportTop, targetLength - 1);
}

function isComponentContainer(component: Component): component is ComponentContainer {
    const candidate = component as { children?: unknown };
    return Array.isArray(candidate.children);
}

function containsComponent(root: Component, target: Component): boolean {
    if (root === target) return true;
    if (!isComponentContainer(root)) return false;

    return root.children.some((child) => containsComponent(child, target));
}

function getFocusedTopLevelChildIndex(
    tui: PatchableTuiInstance,
    footerIndex: number,
): number | undefined {
    const focusedComponent = tui.focusedComponent;
    if (focusedComponent === undefined || focusedComponent === null) return undefined;

    for (let index = 0; index <= footerIndex; index += 1) {
        const child = tui.children[index];
        if (child !== undefined && containsComponent(child, focusedComponent)) return index;
    }

    return undefined;
}

function countRenderedChildLines(
    ranges: readonly ChildLineRange[],
    startIndex: number,
    endIndex: number,
): number {
    let count = 0;
    for (const range of ranges) {
        if (range.index < startIndex || range.index > endIndex) continue;
        count += range.end - range.start;
    }
    return count;
}

function getAnchoredTailStartIndex(tui: PatchableTuiInstance): number | undefined {
    const footerIndex = getFooterChildIndex(tui);
    if (footerIndex === undefined) return undefined;

    const focusedIndex = getFocusedTopLevelChildIndex(tui, footerIndex);
    if (focusedIndex === undefined) return footerIndex;

    // Pi renders the working loader and the extension/widget spacer as the two
    // top-level siblings immediately before the editor container. Keep them in
    // the anchored bottom chrome so shrink padding appears above the loader
    // instead of adding rows between loader/widgets and editor.
    if (focusedIndex >= BOTTOM_CHROME_PRECEDING_SIBLINGS) {
        return focusedIndex - BOTTOM_CHROME_PRECEDING_SIBLINGS;
    }
    return focusedIndex;
}

function enterChildLineRangesFrame(tui: PatchableTuiInstance, width: number): () => void {
    const existingFrame = tui[CHILD_LINE_RANGES_FRAME_KEY];
    if (existingFrame?.width === width) {
        existingFrame.depth += 1;
        return () => {
            existingFrame.depth -= 1;
            if (existingFrame.depth === 0 && tui[CHILD_LINE_RANGES_FRAME_KEY] === existingFrame) {
                tui[CHILD_LINE_RANGES_FRAME_KEY] = undefined;
            }
        };
    }

    const frame: ChildLineRangesFrame = { width, depth: 1 };
    tui[CHILD_LINE_RANGES_FRAME_KEY] = frame;
    return () => {
        frame.depth -= 1;
        if (frame.depth === 0 && tui[CHILD_LINE_RANGES_FRAME_KEY] === frame) {
            tui[CHILD_LINE_RANGES_FRAME_KEY] = undefined;
        }
    };
}

function computeChildLineRanges(tui: PatchableTuiInstance, width: number): ChildLineRange[] {
    const ranges: ChildLineRange[] = [];
    let start = 0;

    for (let index = 0; index < tui.children.length; index += 1) {
        const child = tui.children[index];
        if (child === undefined) continue;

        const lineCount = child.render(width).length;
        ranges.push({ index, start, end: start + lineCount });
        start += lineCount;
    }

    return ranges;
}

function getChildLineRanges(tui: PatchableTuiInstance, width: number): ChildLineRange[] {
    const frame = tui[CHILD_LINE_RANGES_FRAME_KEY];
    if (frame?.width === width && frame.ranges !== undefined) {
        return frame.ranges;
    }

    const ranges = computeChildLineRanges(tui, width);
    if (frame?.width === width) {
        frame.ranges = ranges;
    }
    return ranges;
}

function getAnchoredTailLength(
    tui: PatchableTuiInstance,
    width: number,
    lineCount: number,
    removedBottomChromeRows: number,
): number {
    const footerIndex = getFooterChildIndex(tui);
    const tailStartIndex = getAnchoredTailStartIndex(tui);
    if (footerIndex === undefined || tailStartIndex === undefined) return 1;

    const tailLength = Math.max(
        1,
        countRenderedChildLines(getChildLineRanges(tui, width), tailStartIndex, footerIndex) -
            removedBottomChromeRows,
    );
    return Math.min(tailLength, lineCount);
}

function getRangeForChild(
    ranges: readonly ChildLineRange[],
    childIndex: number,
): ChildLineRange | undefined {
    return ranges.find((range) => range.index === childIndex);
}

function hasVisibleLine(lines: readonly string[], start: number, end: number): boolean {
    for (let index = start; index < end; index += 1) {
        const line = lines[index];
        if (line !== undefined && line.trim().length > 0) return true;
    }
    return false;
}

function compactBottomChromeSpacing(
    tui: PatchableTuiInstance,
    lines: readonly string[],
    width: number,
): BottomChromeSpacingResult {
    const footerIndex = getFooterChildIndex(tui);
    if (footerIndex === undefined) return { lines: [...lines], removedRows: 0 };

    const focusedIndex = getFocusedTopLevelChildIndex(tui, footerIndex);
    if (focusedIndex === undefined) return { lines: [...lines], removedRows: 0 };

    const ranges = getChildLineRanges(tui, width);
    const focusedRange = getRangeForChild(ranges, focusedIndex);
    const tailStartIndex = getAnchoredTailStartIndex(tui);
    if (focusedRange === undefined || tailStartIndex === undefined) {
        return { lines: [...lines], removedRows: 0 };
    }

    const gapIndex = focusedRange.start - 1;
    const gapLine = lines[gapIndex];
    if (gapIndex < 0 || gapLine === undefined || gapLine.trim().length > 0) {
        return { lines: [...lines], removedRows: 0 };
    }

    const tailStartRange = getRangeForChild(ranges, tailStartIndex);
    if (tailStartRange === undefined) return { lines: [...lines], removedRows: 0 };
    if (!hasVisibleLine(lines, tailStartRange.start, gapIndex)) {
        return { lines: [...lines], removedRows: 0 };
    }

    return {
        lines: [...lines.slice(0, gapIndex), ...lines.slice(gapIndex + 1)],
        removedRows: 1,
    };
}

function appendPreviousRowsUntil(
    result: string[],
    tui: PatchableTuiInstance,
    endIndex: number,
): void {
    for (let index = result.length; index < endIndex; index += 1) {
        result.push(stripTerminalLineReset(tui.previousLines[index] ?? ""));
    }
}

function appendBlankRows(result: string[], count: number): void {
    for (let index = 0; index < count; index += 1) {
        result.push("");
    }
}

function appendRowsBeforeAnchoredTail(
    result: string[],
    lines: readonly string[],
    insertIndex: number,
    tailStart: number,
    rowCount: number,
): void {
    if (rowCount <= 0) return;

    if (insertIndex <= tailStart) {
        const visibleRows = lines.slice(insertIndex, tailStart);
        result.push(...visibleRows);
        appendBlankRows(result, rowCount - visibleRows.length);
        return;
    }

    const visibleStart = Math.max(0, tailStart - rowCount);
    const visibleRows = lines.slice(visibleStart, tailStart);
    appendBlankRows(result, rowCount - visibleRows.length);
    result.push(...visibleRows);
}

function padAtVisibleBoundary(
    tui: PatchableTuiInstance,
    lines: readonly string[],
    targetLength: number,
    width: number,
    removedBottomChromeRows: number,
): string[] {
    const tailLength = getAnchoredTailLength(tui, width, lines.length, removedBottomChromeRows);
    const maxInsertIndex = Math.max(0, targetLength - tailLength);
    const insertIndex = Math.min(getPaddingInsertIndex(tui, targetLength), maxInsertIndex);
    const tailStart = Math.max(0, lines.length - tailLength);
    const rowsBeforeTail = Math.max(0, targetLength - insertIndex - tailLength);
    const result: string[] = [];

    appendPreviousRowsUntil(result, tui, insertIndex);
    appendRowsBeforeAnchoredTail(result, lines, insertIndex, tailStart, rowsBeforeTail);
    result.push(...lines.slice(tailStart));
    return result;
}

/**
 * Install an idempotent TUI render patch that compacts Pi's bottom chrome and
 * pads shrinking transcripts above it so status/widgets, editor, and footer stay attached.
 */
export function installFooterShrinkPaddingPatch(): void {
    const prototype = TUI.prototype as unknown as PatchableTuiPrototype;
    if (prototype[FOOTER_SHRINK_PADDING_PATCH_MARKER] === true) return;

    const originalRender = prototype.render;
    if (typeof originalRender !== "function") return;

    prototype.render = function patchedFooterShrinkPaddingRender(
        this: PatchableTuiInstance,
        width: number,
    ): string[] {
        const leaveFrame = enterChildLineRangesFrame(this, width);
        try {
            const lines = compactBottomChromeSpacing(this, originalRender.call(this, width), width);
            if (!shouldPadShrink(this, lines.lines)) return lines.lines;
            return padAtVisibleBoundary(
                this,
                lines.lines,
                this.previousLines.length,
                width,
                lines.removedRows,
            );
        } finally {
            leaveFrame();
        }
    };

    prototype[FOOTER_SHRINK_PADDING_PATCH_MARKER] = true;
}
