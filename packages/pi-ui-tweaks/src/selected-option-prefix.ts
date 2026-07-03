import { SelectList, truncateToWidth, visibleWidth, type SelectItem } from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_SELECTED_OPTION_PREFIX, getUiTweaksPatchState } from "./patch-state.ts";

const PRIMARY_COLUMN_GAP = 2;
const MIN_DESCRIPTION_WIDTH = 10;
const SELECT_LIST_PATCH_KEY = Symbol.for(
    "zigai.pi-ui-tweaks.selected-option-prefix-select-list-patched",
);
const THEME_FG_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.selected-option-prefix-theme-fg-patched");

type SelectListRenderTarget = {
    [SELECT_LIST_PATCH_KEY]?: true;
    theme: {
        selectedText(text: string): string;
        description(text: string): string;
    };
    renderItem(
        item: SelectItem,
        isSelected: boolean,
        width: number,
        descriptionSingleLine: string | undefined,
        primaryColumnWidth: number,
    ): string;
    truncatePrimary(
        item: SelectItem,
        isSelected: boolean,
        maxWidth: number,
        columnWidth: number,
    ): string;
};

type ThemePrototype = {
    [THEME_FG_PATCH_KEY]?: true;
    fg(this: ThemeInstance, color: string, text: string): string;
};

type ThemeInstance = {
    fg(color: string, text: string): string;
};

type ThemeModule = {
    Theme?: {
        prototype?: unknown;
    };
};

function normalizeSelectedOptionPrefix(prefix: string): string {
    if (prefix.length === 0) {
        return DEFAULT_SELECTED_OPTION_PREFIX;
    }
    if (/\s$/u.test(prefix)) {
        return prefix;
    }
    return `${prefix} `;
}

function getUnselectedOptionPrefix(): string {
    return " ".repeat(Math.max(1, visibleWidth(getUiTweaksPatchState().selectedOptionPrefix)));
}

function warnSelectedOptionPrefixPatchUnavailable(error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(
        `[pi-ui-tweaks] selected option prefix patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function isSelectListRenderTarget(value: unknown): value is SelectListRenderTarget {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return (
        typeof Reflect.get(value, "renderItem") === "function" &&
        typeof Reflect.get(value, "truncatePrimary") === "function"
    );
}

function isThemePrototype(value: unknown): value is ThemePrototype {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return typeof Reflect.get(value, "fg") === "function";
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

/**
 * Sets the prefix used for selected rows in Pi selector UIs.
 */
export function setSelectedOptionPrefix(prefix: string): void {
    getUiTweaksPatchState().selectedOptionPrefix = normalizeSelectedOptionPrefix(prefix);
}

export function getSelectedOptionPrefix(): string {
    return getUiTweaksPatchState().selectedOptionPrefix;
}

/**
 * Installs an idempotent patch for Pi TUI's generic select list marker.
 */
export function installSelectedOptionPrefixSelectListPatch(
    prototype: unknown = SelectList.prototype,
): void {
    if (!isSelectListRenderTarget(prototype)) {
        warnSelectedOptionPrefixPatchUnavailable();
        return;
    }
    if (prototype[SELECT_LIST_PATCH_KEY] === true) {
        return;
    }

    prototype.renderItem = function selectedOptionPrefixRenderItem(
        this: SelectListRenderTarget,
        item: SelectItem,
        isSelected: boolean,
        width: number,
        descriptionSingleLine: string | undefined,
        primaryColumnWidth: number,
    ): string {
        let prefix: string;
        if (isSelected) {
            prefix = getUiTweaksPatchState().selectedOptionPrefix;
        } else {
            prefix = getUnselectedOptionPrefix();
        }
        const prefixWidth = visibleWidth(prefix);
        if (descriptionSingleLine !== undefined && width > 40) {
            const effectivePrimaryColumnWidth = Math.max(
                1,
                Math.min(primaryColumnWidth, width - prefixWidth - 4),
            );
            const maxPrimaryWidth = Math.max(1, effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP);
            const truncatedValue = this.truncatePrimary(
                item,
                isSelected,
                maxPrimaryWidth,
                effectivePrimaryColumnWidth,
            );
            const truncatedValueWidth = visibleWidth(truncatedValue);
            const spacing = " ".repeat(
                Math.max(1, effectivePrimaryColumnWidth - truncatedValueWidth),
            );
            const descriptionStart = prefixWidth + truncatedValueWidth + spacing.length;
            const remainingWidth = width - descriptionStart - 2;
            if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
                const truncatedDesc = truncateToWidth(descriptionSingleLine, remainingWidth, "");
                if (isSelected) {
                    return this.theme.selectedText(
                        `${prefix}${truncatedValue}${spacing}${truncatedDesc}`,
                    );
                }
                const descText = this.theme.description(spacing + truncatedDesc);
                return prefix + truncatedValue + descText;
            }
        }

        const maxWidth = width - prefixWidth - 2;
        const truncatedValue = this.truncatePrimary(item, isSelected, maxWidth, maxWidth);
        if (isSelected) {
            return this.theme.selectedText(`${prefix}${truncatedValue}`);
        }
        return prefix + truncatedValue;
    };

    prototype[SELECT_LIST_PATCH_KEY] = true;
}

/**
 * Installs an idempotent patch for Pi selectors that color the hard-coded arrow through Theme.fg.
 */
export async function installSelectedOptionPrefixThemePatch(): Promise<void> {
    try {
        const distDir = await resolvePiDistDir();
        const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;
        const themeModule = (await import(themePath)) as ThemeModule;
        const prototype = themeModule.Theme?.prototype;
        if (!isThemePrototype(prototype)) {
            warnSelectedOptionPrefixPatchUnavailable();
            return;
        }
        if (prototype[THEME_FG_PATCH_KEY] === true) {
            return;
        }

        const originalFgValue: unknown = Reflect.get(prototype, "fg");
        if (typeof originalFgValue !== "function") {
            warnSelectedOptionPrefixPatchUnavailable();
            return;
        }
        const originalFg = originalFgValue as ThemePrototype["fg"];
        prototype.fg = function selectedOptionPrefixFg(
            this: ThemeInstance,
            color: string,
            text: string,
        ): string {
            if (color === "accent" && text === DEFAULT_SELECTED_OPTION_PREFIX) {
                return originalFg.call(this, color, getUiTweaksPatchState().selectedOptionPrefix);
            }
            return originalFg.call(this, color, text);
        };
        prototype[THEME_FG_PATCH_KEY] = true;
    } catch (error: unknown) {
        warnSelectedOptionPrefixPatchUnavailable(error);
    }
}
