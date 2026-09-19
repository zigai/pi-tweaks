import type { Api, Model } from "@earendil-works/pi-ai";
import {
    CURSOR_MARKER,
    fuzzyFilter,
    Input,
    Key,
    matchesKey,
    truncateToWidth,
    visibleWidth,
} from "@earendil-works/pi-tui";

import type { MouseInputEvent, MouseInputResult } from "./mouse-input.ts";
import { renderSelectionIndicator } from "./selection-indicator.ts";

export const MODEL_PICKER_WIDTH = 40;
const SEARCH_LINE_COUNT = 1;
const MAX_VISIBLE_MODELS = 8;

export type ModelPickerTheme = {
    bg(role: "toolPendingBg" | "selectedBg", text: string): string;
    fg(role: "accent" | "borderAccent" | "dim" | "text", text: string): string;
};

export type ModelPickerOptions = {
    activeModel: Model<Api>;
    models: readonly Model<Api>[];
    theme: ModelPickerTheme;
    requestRender(): void;
    onSelect(model: Model<Api>): void;
    onCancel(): void;
};

function padLine(text: string, width: number): string {
    const truncated = truncateToWidth(text, width, "");
    return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function modelKey(model: Model<Api>): string {
    return `${model.provider}/${model.id}`;
}

function searchableModelText(model: Model<Api>): string {
    return `${model.name} ${model.id}`;
}

export function createModelPicker(options: ModelPickerOptions) {
    const input = new Input();
    let filteredModels = [...options.models];
    let selectedIndex = Math.max(
        0,
        filteredModels.findIndex((model) => modelKey(model) === modelKey(options.activeModel)),
    );
    let scrollOffset = 0;

    const ensureSelectionVisible = (): void => {
        if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;

        if (selectedIndex >= scrollOffset + MAX_VISIBLE_MODELS) {
            scrollOffset = selectedIndex - MAX_VISIBLE_MODELS + 1;
        }
    };

    const refreshFilter = (): void => {
        const previousSelection = filteredModels.at(selectedIndex);

        filteredModels = fuzzyFilter([...options.models], input.getValue(), (model) =>
            searchableModelText(model),
        );
        selectedIndex = 0;

        if (previousSelection !== undefined) {
            const previousIndex = filteredModels.findIndex(
                (model) => modelKey(model) === modelKey(previousSelection),
            );
            if (previousIndex >= 0) selectedIndex = previousIndex;
        }

        scrollOffset = 0;
        ensureSelectionVisible();
    };

    const moveSelection = (offset: number): void => {
        if (filteredModels.length === 0) return;

        selectedIndex = Math.max(0, Math.min(filteredModels.length - 1, selectedIndex + offset));
        ensureSelectionVisible();
        options.requestRender();
    };

    const selectCurrent = (): void => {
        const selected = filteredModels.at(selectedIndex);
        if (selected !== undefined) options.onSelect(selected);
    };

    input.onSubmit = () => selectCurrent();
    input.onEscape = () => options.onCancel();

    return {
        get focused(): boolean {
            return input.focused;
        },
        set focused(value: boolean) {
            input.focused = value;
        },
        handleInput(data: string): void {
            if (matchesKey(data, Key.up)) {
                moveSelection(-1);
                return;
            }

            if (matchesKey(data, Key.down)) {
                moveSelection(1);
                return;
            }

            input.handleInput(data);
            refreshFilter();
            options.requestRender();
        },
        handleMouse(event: MouseInputEvent): MouseInputResult | undefined {
            if (event.type === "wheel") {
                const wheelDelta = event.wheelDelta ?? 0;
                if (wheelDelta < 0) moveSelection(-1);
                if (wheelDelta > 0) moveSelection(1);
                return { handled: true, render: false };
            }

            if (event.type !== "click" || event.button !== "left") return undefined;

            const clickedIndex = scrollOffset + event.y - SEARCH_LINE_COUNT;
            if (clickedIndex < 0 || clickedIndex >= filteredModels.length) return undefined;

            selectedIndex = clickedIndex;
            selectCurrent();

            return { handled: true, render: false };
        },
        invalidate(): void {
            input.invalidate();
        },
        render(width: number): string[] {
            const searchWidth = Math.max(0, width - 2);
            let search = input.render(searchWidth).at(0) ?? "";
            if (input.getValue().length === 0) {
                search = `${CURSOR_MARKER}${options.theme.fg("dim", "Search models…")}`;
            }

            const lines = [options.theme.bg("toolPendingBg", ` ${padLine(search, searchWidth)} `)];

            const visibleModels = filteredModels.slice(
                scrollOffset,
                scrollOffset + MAX_VISIBLE_MODELS,
            );
            if (visibleModels.length === 0) {
                const empty = options.theme.fg("dim", padLine("  No models", width));
                lines.push(options.theme.bg("toolPendingBg", empty));
                return lines;
            }

            for (const [visibleIndex, model] of visibleModels.entries()) {
                const index = scrollOffset + visibleIndex;
                const isSelected = index === selectedIndex;
                const cursor = renderSelectionIndicator(options.theme, isSelected);
                let currentMarker = "";
                if (modelKey(model) === modelKey(options.activeModel)) {
                    currentMarker = options.theme.fg("borderAccent", " ✓");
                }

                let modelName = model.name;
                if (isSelected) modelName = options.theme.fg("text", modelName);

                const text = padLine(`${cursor}${modelName}${currentMarker}`, width);
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
