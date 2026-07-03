import { TUI, type Component } from "@earendil-works/pi-tui";

import { getUiTweaksPatchState } from "./patch-state.ts";

const ANCHOR_INPUT_TO_BOTTOM_PATCHED = Symbol.for(
    "zigai.pi-ui-tweaks.anchor-input-to-bottom-patched",
);
const BOTTOM_CHROME_PRECEDING_SIBLINGS = 2;

type ComponentContainer = Component & {
    children: Component[];
};

type PatchableTuiInstance = {
    children: Component[];
    focusedComponent?: Component | null;
    terminal?: {
        rows?: number;
    };
};

type PatchableTuiRender = (this: PatchableTuiInstance, width: number) => string[];

type ChildLineRange = {
    index: number;
    start: number;
    end: number;
};

type BottomChromeSpacing = {
    lines: string[];
    bottomChromeStartLine: number;
};

type PatchableTuiPrototype = {
    render?: PatchableTuiRender;
    [ANCHOR_INPUT_TO_BOTTOM_PATCHED]?: true;
};

function warnAnchorInputToBottomPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined) {
        suffix = `: ${reason}`;
    }
    console.warn(
        `[pi-ui-tweaks] anchor input to bottom patch unavailable; Pi internals may have changed${suffix}`,
    );
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

function getFocusedTopLevelChildIndex(tui: PatchableTuiInstance): number | undefined {
    const focusedComponent = tui.focusedComponent;
    if (focusedComponent === undefined || focusedComponent === null) return undefined;

    for (let index = 0; index < tui.children.length; index += 1) {
        const child = tui.children[index];
        if (child !== undefined && containsComponent(child, focusedComponent)) return index;
    }

    return undefined;
}

function getBottomChromeStartChildIndex(tui: PatchableTuiInstance): number | undefined {
    const focusedIndex = getFocusedTopLevelChildIndex(tui);
    if (focusedIndex === undefined) return undefined;
    if (focusedIndex >= BOTTOM_CHROME_PRECEDING_SIBLINGS) {
        return focusedIndex - BOTTOM_CHROME_PRECEDING_SIBLINGS;
    }
    return focusedIndex;
}

function getChildLineRanges(children: readonly Component[], width: number): ChildLineRange[] {
    const ranges: ChildLineRange[] = [];
    let start = 0;

    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child === undefined) continue;

        const lineCount = child.render(width).length;
        ranges.push({ index, start, end: start + lineCount });
        start += lineCount;
    }

    return ranges;
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
): BottomChromeSpacing | undefined {
    const focusedIndex = getFocusedTopLevelChildIndex(tui);
    if (focusedIndex === undefined) return undefined;

    const bottomChromeStartChildIndex = getBottomChromeStartChildIndex(tui);
    if (bottomChromeStartChildIndex === undefined) return undefined;

    const ranges = getChildLineRanges(tui.children, width);
    const focusedRange = getRangeForChild(ranges, focusedIndex);
    const bottomChromeStartRange = getRangeForChild(ranges, bottomChromeStartChildIndex);
    if (focusedRange === undefined || bottomChromeStartRange === undefined) return undefined;

    const gapIndex = focusedRange.start - 1;
    const gapLine = lines[gapIndex];
    if (gapIndex < 0 || gapLine === undefined || gapLine.trim().length > 0) {
        return { lines: [...lines], bottomChromeStartLine: bottomChromeStartRange.start };
    }
    if (!hasVisibleLine(lines, bottomChromeStartRange.start, gapIndex)) {
        return { lines: [...lines], bottomChromeStartLine: bottomChromeStartRange.start };
    }

    return {
        lines: [...lines.slice(0, gapIndex), ...lines.slice(gapIndex + 1)],
        bottomChromeStartLine: bottomChromeStartRange.start,
    };
}

function appendBlankRows(result: string[], count: number): void {
    for (let index = 0; index < count; index += 1) {
        result.push("");
    }
}

function getTerminalRows(tui: PatchableTuiInstance): number | undefined {
    const rows = tui.terminal?.rows;
    if (rows === undefined || !Number.isFinite(rows)) return undefined;
    const roundedRows = Math.floor(rows);
    if (roundedRows <= 0) return undefined;
    return roundedRows;
}

function anchorInputToBottomLines(
    tui: PatchableTuiInstance,
    lines: readonly string[],
    width: number,
): string[] {
    if (!getUiTweaksPatchState().anchorInputToBottom) return [...lines];

    const compacted = compactBottomChromeSpacing(tui, lines, width);
    if (compacted === undefined) return [...lines];

    const terminalRows = getTerminalRows(tui);
    if (terminalRows === undefined) return compacted.lines;
    if (compacted.lines.length >= terminalRows) return compacted.lines;

    const bottomChromeStartLine = Math.min(compacted.lines.length, compacted.bottomChromeStartLine);
    const blankRowCount = terminalRows - compacted.lines.length;
    const result = compacted.lines.slice(0, bottomChromeStartLine);
    appendBlankRows(result, blankRowCount);
    result.push(...compacted.lines.slice(bottomChromeStartLine));
    return result;
}

/**
 * Sets whether short Pi screens should add blank rows above the input/footer chrome.
 */
export function setAnchorInputToBottom(enabled: boolean): void {
    getUiTweaksPatchState().anchorInputToBottom = enabled;
}

/**
 * Installs an idempotent patch that keeps the focused input/footer at the terminal bottom.
 */
export function installAnchorInputToBottomPatch(
    prototype: PatchableTuiPrototype = TUI.prototype as unknown as PatchableTuiPrototype,
): void {
    if (prototype[ANCHOR_INPUT_TO_BOTTOM_PATCHED] === true) return;

    const originalRenderValue: unknown = Reflect.get(prototype, "render");
    if (typeof originalRenderValue !== "function") {
        warnAnchorInputToBottomPatchUnavailable("missing render");
        return;
    }

    const originalRender = originalRenderValue as PatchableTuiRender;
    prototype.render = function anchorInputToBottomRender(
        this: PatchableTuiInstance,
        width: number,
    ): string[] {
        const lines = originalRender.call(this, width);
        return anchorInputToBottomLines(this, lines, width);
    };
    prototype[ANCHOR_INPUT_TO_BOTTOM_PATCHED] = true;
}
