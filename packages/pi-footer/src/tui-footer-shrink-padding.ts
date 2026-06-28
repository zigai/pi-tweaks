import { TUI, type Component } from "@earendil-works/pi-tui";

import { getFooterComponentKind } from "./footer-component.ts";

const FOOTER_SHRINK_PADDING_PATCH_MARKER = Symbol.for(
    "zigai.pi-footer.tui-footer-shrink-padding-patch",
);
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const TERMINAL_LINE_RESET = `${ESC}[0m${ESC}]8;;${BEL}`;

type PatchableTuiInstance = {
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

function shouldPadShrink(tui: PatchableTuiInstance, lines: readonly string[]): boolean {
    if (!isStableTerminalSize(tui)) return false;
    if (!hasPiFooter(tui)) return false;
    if (!Array.isArray(tui.previousLines)) return false;
    if (tui.previousLines.length <= lines.length) return false;
    if (tui.previousLines.length < tui.terminal.rows) return false;
    return lines.length > 0;
}

function stripTerminalLineReset(line: string): string {
    if (!line.endsWith(TERMINAL_LINE_RESET)) return line;
    return line.slice(0, -TERMINAL_LINE_RESET.length);
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
    children: readonly Component[],
    startIndex: number,
    endIndex: number,
    width: number,
): number {
    let count = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
        const child = children[index];
        if (child === undefined) continue;
        count += child.render(width).length;
    }
    return count;
}

function getAnchoredTailLength(
    tui: PatchableTuiInstance,
    width: number,
    lineCount: number,
): number {
    const footerIndex = getFooterChildIndex(tui);
    if (footerIndex === undefined) return 1;

    const focusedIndex = getFocusedTopLevelChildIndex(tui, footerIndex);
    let tailStartIndex = footerIndex;
    if (focusedIndex !== undefined) {
        tailStartIndex = focusedIndex;
    }

    const tailLength = countRenderedChildLines(tui.children, tailStartIndex, footerIndex, width);
    if (tailLength <= 0) return 1;
    return Math.min(tailLength, lineCount);
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
): string[] {
    const tailLength = getAnchoredTailLength(tui, width, lines.length);
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
 * Install an idempotent TUI render patch that pads shrinking transcripts above
 * the focused bottom chrome so the editor remains attached to the footer.
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
        const lines = originalRender.call(this, width);
        if (!shouldPadShrink(this, lines)) return lines;
        return padAtVisibleBoundary(this, lines, this.previousLines.length, width);
    };

    prototype[FOOTER_SHRINK_PADDING_PATCH_MARKER] = true;
}
