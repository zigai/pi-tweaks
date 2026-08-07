import { TuiAltScreen, TuiMainScreen, type Component } from "@earendil-works/pi-tui";

import { getUiTweaksPatchState } from "./patch-state.ts";

const ANCHOR_INPUT_TO_BOTTOM_PATCHED = Symbol.for(
    "zigai.pi-ui-tweaks.anchor-input-to-bottom-patched",
);
const FULLSCREEN_ANCHOR_INPUT_TO_BOTTOM_PATCHED = Symbol.for(
    "zigai.pi-ui-tweaks.fullscreen-anchor-input-to-bottom-patched",
);
const CHILD_LINE_RANGES_FRAME_KEY = Symbol.for("zigai.pi-tweaks.tui-child-line-ranges-frame");
const BOTTOM_CHROME_PRECEDING_SIBLINGS = 2;

type ComponentContainer = Component & {
    children: Component[];
};

type PatchableTuiInstance = {
    [CHILD_LINE_RANGES_FRAME_KEY]?: ChildLineRangesFrame;
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

type ChildLineRangesFrame = {
    width: number;
    depth: number;
    recording: boolean;
    ranges?: ChildLineRange[];
};

type BottomChromeSpacing = {
    lines: string[];
    bottomChromeStartLine: number;
    removedLineIndex?: number;
};

type PatchableTuiPrototype = {
    render?: PatchableTuiRender;
    [ANCHOR_INPUT_TO_BOTTOM_PATCHED]?: true;
};

type PatchableFullscreenTuiInstance = {
    focusedComponent?: Component | null;
    layoutRoot?: Component;
};

type PatchableFullscreenDoRender = (this: PatchableFullscreenTuiInstance) => void;

type PatchableFullscreenTuiPrototype = {
    doRender?: PatchableFullscreenDoRender;
    [FULLSCREEN_ANCHOR_INPUT_TO_BOTTOM_PATCHED]?: true;
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
    const children: unknown = Reflect.get(component, "children") as unknown;
    return Array.isArray(children);
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

    const frame: ChildLineRangesFrame = { width, depth: 1, recording: false };
    tui[CHILD_LINE_RANGES_FRAME_KEY] = frame;
    return () => {
        frame.depth -= 1;
        if (frame.depth === 0 && tui[CHILD_LINE_RANGES_FRAME_KEY] === frame) {
            tui[CHILD_LINE_RANGES_FRAME_KEY] = undefined;
        }
    };
}

function renderWithChildLineRanges(
    tui: PatchableTuiInstance,
    width: number,
    render: PatchableTuiRender,
): string[] {
    const frame = tui[CHILD_LINE_RANGES_FRAME_KEY];
    if (frame?.width !== width || frame.recording) {
        return render.call(tui, width);
    }

    const originals: Array<{
        child: Component;
        ownDescriptor: PropertyDescriptor | undefined;
    }> = [];
    const ranges: ChildLineRange[] = [];
    let start = 0;
    frame.recording = true;
    frame.ranges = ranges;

    try {
        for (let index = 0; index < tui.children.length; index += 1) {
            const child = tui.children[index];
            if (child === undefined) continue;

            const originalRender = child.render.bind(child);
            const ownDescriptor = Object.getOwnPropertyDescriptor(child, "render");
            originals.push({ child, ownDescriptor });
            child.render = function renderAndRecordChildLines(this: Component, childWidth: number) {
                const lines = originalRender.call(this, childWidth);
                ranges.push({ index, start, end: start + lines.length });
                start += lines.length;
                return lines;
            };
        }

        return render.call(tui, width);
    } finally {
        for (const original of originals) {
            if (original.ownDescriptor === undefined) {
                Reflect.deleteProperty(original.child, "render");
            } else {
                Object.defineProperty(original.child, "render", original.ownDescriptor);
            }
        }
        frame.recording = false;
    }
}

function getChildLineRanges(tui: PatchableTuiInstance, width: number): ChildLineRange[] {
    const frame = tui[CHILD_LINE_RANGES_FRAME_KEY];
    if (frame?.width === width && frame.ranges !== undefined) {
        return frame.ranges;
    }

    return [];
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

function findComponentPath(
    root: Component,
    target: Component,
    visited = new Set<Component>(),
): Component[] | undefined {
    if (root === target) return [root];
    if (visited.has(root)) return undefined;
    visited.add(root);
    if (!isComponentContainer(root)) return undefined;

    for (const child of root.children) {
        const path = findComponentPath(child, target, visited);
        if (path !== undefined) return [root, ...path];
    }
    return undefined;
}

function isVerticalLayoutStack(component: Component): component is ComponentContainer {
    if (!isComponentContainer(component)) return false;
    return Reflect.get(component, "layoutType") === "vstack";
}

function getFullscreenBlankPrecedingComponent(
    tui: PatchableFullscreenTuiInstance,
): Component | undefined {
    const layoutRoot = tui.layoutRoot;
    const focusedComponent = tui.focusedComponent;
    if (layoutRoot === undefined || focusedComponent === undefined || focusedComponent === null) {
        return undefined;
    }

    const path = findComponentPath(layoutRoot, focusedComponent);
    if (path === undefined) return undefined;

    for (let pathIndex = path.length - 2; pathIndex >= 0; pathIndex -= 1) {
        const parent = path[pathIndex];
        const child = path[pathIndex + 1];
        if (parent === undefined || child === undefined) continue;
        if (!isVerticalLayoutStack(parent)) continue;

        const childIndex = parent.children.indexOf(child);
        if (childIndex <= BOTTOM_CHROME_PRECEDING_SIBLINGS) continue;

        const precedingComponent = parent.children[childIndex - 1];
        if (precedingComponent !== undefined) return precedingComponent;
    }

    return undefined;
}

function temporarilyCompactBlankComponent(
    component: Component | undefined,
): (() => void) | undefined {
    if (component === undefined) return undefined;

    const originalRenderValue: unknown = Reflect.get(component, "render");
    if (typeof originalRenderValue !== "function") return undefined;

    const originalRender = originalRenderValue as Component["render"];
    const ownDescriptor = Object.getOwnPropertyDescriptor(component, "render");
    const compactedRender: Component["render"] = function compactedBlankComponentRender(
        this: Component,
        width: number,
    ): string[] {
        const lines = originalRender.call(this, width);
        if (lines.length === 0 || hasVisibleLine(lines, 0, lines.length)) return lines;
        return [];
    };

    if (!Reflect.set(component, "render", compactedRender)) return undefined;

    return () => {
        if (ownDescriptor === undefined) {
            Reflect.deleteProperty(component, "render");
        } else {
            Object.defineProperty(component, "render", ownDescriptor);
        }
    };
}

function compactFullscreenChromeForRender(
    tui: PatchableFullscreenTuiInstance,
): (() => void) | undefined {
    if (!getUiTweaksPatchState().anchorInputToBottom) return undefined;

    return temporarilyCompactBlankComponent(getFullscreenBlankPrecedingComponent(tui));
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

    const ranges = getChildLineRanges(tui, width);
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
        removedLineIndex: gapIndex,
    };
}

function updateChildLineRangesAfterLayout(
    tui: PatchableTuiInstance,
    removedLineIndex: number | undefined,
    insertedLineIndex: number,
    insertedLineCount: number,
): void {
    const ranges = tui[CHILD_LINE_RANGES_FRAME_KEY]?.ranges;
    if (ranges === undefined) return;

    if (removedLineIndex !== undefined) {
        for (const range of ranges) {
            if (range.end <= removedLineIndex) continue;
            if (range.start > removedLineIndex) {
                range.start -= 1;
            }
            range.end -= 1;
        }
    }

    if (insertedLineCount <= 0) return;
    for (const range of ranges) {
        if (range.start < insertedLineIndex) continue;
        range.start += insertedLineCount;
        range.end += insertedLineCount;
    }
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
    let blankRowCount = 0;
    if (terminalRows !== undefined && compacted.lines.length < terminalRows) {
        blankRowCount = terminalRows - compacted.lines.length;
    }

    updateChildLineRangesAfterLayout(
        tui,
        compacted.removedLineIndex,
        compacted.bottomChromeStartLine,
        blankRowCount,
    );
    if (blankRowCount === 0) return compacted.lines;

    const bottomChromeStartLine = Math.min(compacted.lines.length, compacted.bottomChromeStartLine);
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
function installMainAnchorInputToBottomPatch(prototype?: PatchableTuiPrototype): void {
    const prototypeValue: unknown = prototype ?? TuiMainScreen.prototype;
    if (
        (typeof prototypeValue !== "object" && typeof prototypeValue !== "function") ||
        prototypeValue === null
    ) {
        warnAnchorInputToBottomPatchUnavailable();
        return;
    }
    const originalRenderValue: unknown = Reflect.get(prototypeValue, "render") as unknown;
    if (typeof originalRenderValue !== "function") {
        warnAnchorInputToBottomPatchUnavailable("missing render");
        return;
    }
    // SAFETY: The guarded TUI boundary verifies the private render method before
    // patching the smallest prototype seam used by this layout adapter.
    prototype = prototypeValue;
    if (prototype[ANCHOR_INPUT_TO_BOTTOM_PATCHED] === true) return;
    // SAFETY: The immediately preceding runtime guard proves the private TUI render seam is callable.
    const originalRender = originalRenderValue as PatchableTuiRender;
    prototype.render = function anchorInputToBottomRender(
        this: PatchableTuiInstance,
        width: number,
    ): string[] {
        const leaveFrame = enterChildLineRangesFrame(this, width);
        try {
            const lines = renderWithChildLineRanges(this, width, originalRender);
            return anchorInputToBottomLines(this, lines, width);
        } finally {
            leaveFrame();
        }
    };
    prototype[ANCHOR_INPUT_TO_BOTTOM_PATCHED] = true;
}

function installFullscreenAnchorInputToBottomPatch(): void {
    const prototypeValue: unknown = TuiAltScreen.prototype;
    if (
        (typeof prototypeValue !== "object" && typeof prototypeValue !== "function") ||
        prototypeValue === null
    ) {
        warnAnchorInputToBottomPatchUnavailable("missing fullscreen prototype");
        return;
    }

    const originalDoRenderValue: unknown = Reflect.get(prototypeValue, "doRender") as unknown;
    if (typeof originalDoRenderValue !== "function") {
        warnAnchorInputToBottomPatchUnavailable("missing fullscreen doRender");
        return;
    }

    // SAFETY: The guarded fullscreen TUI boundary verifies the private render
    // method before patching the smallest seam that owns layout-frame rendering.
    const prototype = prototypeValue as PatchableFullscreenTuiPrototype;
    if (prototype[FULLSCREEN_ANCHOR_INPUT_TO_BOTTOM_PATCHED] === true) return;

    // SAFETY: The immediately preceding runtime guard proves the private TUI
    // render seam is callable.
    const originalDoRender = originalDoRenderValue as PatchableFullscreenDoRender;
    prototype.doRender = function fullscreenAnchorInputToBottomRender(
        this: PatchableFullscreenTuiInstance,
    ): void {
        const restore = compactFullscreenChromeForRender(this);
        try {
            originalDoRender.call(this);
        } finally {
            restore?.();
        }
    };
    prototype[FULLSCREEN_ANCHOR_INPUT_TO_BOTTOM_PATCHED] = true;
}

/**
 * Installs idempotent patches that keep the focused input/footer at the terminal bottom.
 */
export function installAnchorInputToBottomPatch(prototype?: PatchableTuiPrototype): void {
    installMainAnchorInputToBottomPatch(prototype);
    if (prototype === undefined) installFullscreenAnchorInputToBottomPatch();
}
