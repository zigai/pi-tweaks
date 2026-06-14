import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { WIDGET_KEY } from "./constants.ts";

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

    if (workedForText === undefined || workedForText.length === 0) {
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        return;
    }

    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
        render(width: number): string[] {
            if (width <= 0) return [""];
            let text = `Worked for ${workedForText}.`;
            if (tokensPerSecond !== undefined && tokensPerSecond > 0) {
                text = `${text} [${tokensPerSecond} tok/s]`;
            }
            const truncated = truncateToWidth(text, Math.max(0, width - 1), "");
            return [theme.fg("dim", ` ${truncated}`)];
        },
        invalidate() {},
    }));
}
