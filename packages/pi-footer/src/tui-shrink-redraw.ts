import { TUI } from "@earendil-works/pi-tui";

const TUI_SHRINK_REDRAW_PATCH_MARKER = Symbol.for("zigai.pi-footer.tui-shrink-redraw-patch");

type PatchableTuiInstance = {
    previousLines?: unknown;
    previousViewportTop?: unknown;
    fullRedrawCount?: unknown;
    overlayStack?: unknown;
    requestRender(force?: boolean): void;
};

type PatchableTuiPrototype = {
    doRender?: (this: PatchableTuiInstance) => void;
    requestRender?: (this: PatchableTuiInstance, force?: boolean) => void;
    [TUI_SHRINK_REDRAW_PATCH_MARKER]?: true;
};

function getLineCount(tui: PatchableTuiInstance): number {
    if (!Array.isArray(tui.previousLines)) return 0;
    return tui.previousLines.length;
}

function getNumber(value: unknown): number | undefined {
    if (typeof value !== "number") return undefined;
    if (!Number.isFinite(value)) return undefined;
    return value;
}

function hasOverlayStack(tui: PatchableTuiInstance): boolean {
    if (!Array.isArray(tui.overlayStack)) return false;
    return tui.overlayStack.length > 0;
}

function fullRedrawOccurred(previous: number | undefined, next: number | undefined): boolean {
    if (previous === undefined || next === undefined) return false;
    return next > previous;
}

function shouldForceRedrawAfterShrink(
    tui: PatchableTuiInstance,
    previousLineCount: number,
    nextLineCount: number,
    previousViewportTop: number | undefined,
    previousFullRedrawCount: number | undefined,
): boolean {
    if (nextLineCount >= previousLineCount) return false;
    if (previousViewportTop === undefined || previousViewportTop <= 0) return false;
    if (hasOverlayStack(tui)) return false;

    const nextFullRedrawCount = getNumber(tui.fullRedrawCount);
    if (fullRedrawOccurred(previousFullRedrawCount, nextFullRedrawCount)) return false;

    return true;
}

export function patchTuiShrinkRedraw(): void {
    // Pi's differential renderer does not re-anchor the viewport when content
    // shrinks while scrolled. That can leave the footer one row above the
    // terminal bottom after a transient loader/widget row disappears. Force a
    // one-shot full redraw after such a shrink so the viewport snaps back to the
    // bottom without requiring extension widgets to render placeholder rows.
    const prototype = TUI.prototype as unknown as PatchableTuiPrototype;
    if (prototype[TUI_SHRINK_REDRAW_PATCH_MARKER] === true) return;

    const originalDoRender = prototype.doRender;
    const originalRequestRender = prototype.requestRender;
    if (typeof originalDoRender !== "function") return;
    if (typeof originalRequestRender !== "function") return;

    prototype.doRender = function patchedDoRender(this: PatchableTuiInstance): void {
        const previousLineCount = getLineCount(this);
        const previousViewportTop = getNumber(this.previousViewportTop);
        const previousFullRedrawCount = getNumber(this.fullRedrawCount);

        originalDoRender.call(this);

        const nextLineCount = getLineCount(this);
        if (
            !shouldForceRedrawAfterShrink(
                this,
                previousLineCount,
                nextLineCount,
                previousViewportTop,
                previousFullRedrawCount,
            )
        ) {
            return;
        }

        originalRequestRender.call(this, true);
    };

    prototype[TUI_SHRINK_REDRAW_PATCH_MARKER] = true;
}
