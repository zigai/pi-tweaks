import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { MouseInputEvent, MouseInputResult } from "./mouse-input.ts";
import { renderSelectionIndicator } from "./selection-indicator.ts";

export const THINKING_PICKER_WIDTH = 14;
const TITLE_LINE_COUNT = 1;

export type ThinkingPickerTheme = {
    bg(role: "toolPendingBg" | "selectedBg", text: string): string;
    fg(role: "accent" | "borderAccent" | "dim" | "text", text: string): string;
};

export type ThinkingPickerOptions = {
    currentLevel: ThinkingLevel;
    levels: readonly ThinkingLevel[];
    theme: ThinkingPickerTheme;
    requestRender(): void;
    onSelect(level: ThinkingLevel): void;
    onCancel(): void;
};

function padLine(text: string, width: number): string {
    const truncated = truncateToWidth(text, width, "");
    return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export function createThinkingPicker(options: ThinkingPickerOptions) {
    let selectedIndex = Math.max(0, options.levels.indexOf(options.currentLevel));

    const moveSelection = (offset: number): void => {
        selectedIndex = Math.max(0, Math.min(options.levels.length - 1, selectedIndex + offset));
        options.requestRender();
    };

    const selectCurrent = (): void => {
        const selected = options.levels[selectedIndex];
        options.onSelect(selected);
    };

    return {
        handleInput(data: string): void {
            if (matchesKey(data, Key.up)) {
                moveSelection(-1);
                return;
            }

            if (matchesKey(data, Key.down)) {
                moveSelection(1);
                return;
            }

            if (matchesKey(data, Key.enter)) {
                selectCurrent();
                return;
            }

            if (matchesKey(data, Key.escape)) options.onCancel();
        },
        handleMouse(event: MouseInputEvent): MouseInputResult | undefined {
            if (event.type !== "click" || event.button !== "left") return undefined;

            const clickedIndex = event.y - TITLE_LINE_COUNT;
            if (clickedIndex < 0 || clickedIndex >= options.levels.length) return undefined;

            selectedIndex = clickedIndex;
            selectCurrent();

            return { handled: true, render: false };
        },
        invalidate(): void {},
        render(width: number): string[] {
            const contentWidth = Math.max(0, width - 2);
            const title = options.theme.fg("dim", padLine("Thinking", contentWidth));
            const lines = [options.theme.bg("toolPendingBg", ` ${title} `)];

            for (const [index, level] of options.levels.entries()) {
                const isSelected = index === selectedIndex;
                const prefix = renderSelectionIndicator(options.theme, isSelected);
                let label: string = level;
                if (isSelected) label = options.theme.fg("text", label);

                const text = padLine(`${prefix}${label}`, width);

                if (isSelected) {
                    lines.push(options.theme.bg("selectedBg", text));
                } else {
                    lines.push(options.theme.bg("toolPendingBg", text));
                }
            }

            return lines;
        },
    };
}
