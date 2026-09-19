import { visibleWidth } from "@earendil-works/pi-tui";

const PI_SELECTION_INDICATOR = "→ ";

type SelectionIndicatorTheme = {
    fg(role: "accent", text: string): string;
};

export function renderSelectionIndicator(
    theme: SelectionIndicatorTheme,
    selected: boolean,
): string {
    const indicator = theme.fg("accent", PI_SELECTION_INDICATOR);
    if (selected) return indicator;

    return " ".repeat(Math.max(1, visibleWidth(indicator)));
}
