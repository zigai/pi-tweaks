import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { WIDGET_KEY } from "./constants.ts";
import { getStatusBarSnapshot } from "./status-bar-api.ts";

let workedForWidgetSignature: string | undefined;

export function resetWorkedForWidgetCache(): void {
    workedForWidgetSignature = undefined;
}

export function clearWorkedForWidget(ctx: ExtensionContext): void {
    if (ctx.hasUI !== true) return;
    workedForWidgetSignature = undefined;
    ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export function formatDuration(ms: number): string {
    const wholeSeconds = Math.max(0, Math.round(ms / 1000));
    if (wholeSeconds < 60) return `${wholeSeconds}s`;

    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
}

export function setWorkedForWidget(
    ctx: ExtensionContext,
    workedForText?: string,
    tokensPerSecond?: number,
): void {
    if (ctx.hasUI !== true) return;

    const snapshot = getStatusBarSnapshot();
    if (!snapshot.idle.visible) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        workedForWidgetSignature = undefined;
        return;
    }

    let nextSignature: string | undefined;
    const idleSegments = snapshot.segments
        .filter((segment) => segment.states.includes("idle"))
        .map((segment) => segment.text)
        .join(" · ");
    if (
        snapshot.idle.text !== undefined ||
        idleSegments.length > 0 ||
        (workedForText !== undefined &&
            workedForText.length > 0 &&
            snapshot.idle.showLastRunSummary)
    ) {
        nextSignature = `${snapshot.idle.text ?? ""}\0${idleSegments}\0${workedForText ?? ""}\0${tokensPerSecond ?? ""}\0${snapshot.idle.showLastRunSummary}`;
    }
    if (nextSignature === workedForWidgetSignature) {
        return;
    }
    workedForWidgetSignature = nextSignature;

    if (nextSignature === undefined) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        return;
    }

    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
        render(width: number): string[] {
            if (width <= 0) return [""];
            const parts: string[] = [];
            if (snapshot.idle.text !== undefined) {
                parts.push(snapshot.idle.text);
            }
            if (snapshot.idle.showLastRunSummary && workedForText !== undefined) {
                let summary = `Worked for ${workedForText}.`;
                if (tokensPerSecond !== undefined && tokensPerSecond > 0) {
                    summary = `${summary} [${tokensPerSecond} tok/s]`;
                }
                parts.push(summary);
            }
            if (idleSegments.length > 0) {
                parts.push(idleSegments);
            }
            const text = parts.join(" · ");
            const truncated = truncateToWidth(text, Math.max(0, width - 1), "");
            return [theme.fg("dim", ` ${truncated}`)];
        },
        invalidate() {},
    }));
}
