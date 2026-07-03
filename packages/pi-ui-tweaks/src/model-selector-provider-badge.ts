import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getUiTweaksPatchState } from "./patch-state.ts";

const MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY = Symbol.for(
    "zigai.pi-ui-tweaks.model-selector-provider-badge-patched",
);

type ModelItemLike = {
    readonly id: string;
    readonly provider: string;
};

type TextLike = {
    text?: unknown;
    setText?: (text: string) => void;
};

type ContainerLike = {
    children?: unknown;
};

type ModelSelectorProviderBadgeTarget = {
    [MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY]?: true;
    filteredModels?: unknown;
    listContainer?: ContainerLike;
    selectedIndex?: unknown;
    updateList?: (this: ModelSelectorProviderBadgeTarget) => void;
};

type ThemeInstance = {
    fg(color: string, text: string): string;
};

type ThemeModule = {
    theme?: ThemeInstance;
};

function warnModelSelectorProviderBadgePatchUnavailable(error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(
        `[pi-ui-tweaks] selected model provider badge patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function isModelItemLike(value: unknown): value is ModelItemLike {
    if (typeof value !== "object" || value === null) return false;
    return (
        typeof Reflect.get(value, "id") === "string" &&
        typeof Reflect.get(value, "provider") === "string"
    );
}

function isTextLike(value: unknown): value is TextLike {
    if (typeof value !== "object" || value === null) return false;
    return (
        typeof Reflect.get(value, "text") === "string" &&
        typeof Reflect.get(value, "setText") === "function"
    );
}

function getSelectedModelItem(target: ModelSelectorProviderBadgeTarget): ModelItemLike | undefined {
    const selectedIndex = target.selectedIndex;
    if (typeof selectedIndex !== "number") return undefined;

    const filteredModels = target.filteredModels;
    if (!Array.isArray(filteredModels)) return undefined;

    const selectedModel = filteredModels[selectedIndex];
    if (!isModelItemLike(selectedModel)) return undefined;
    return selectedModel;
}

function getListChildren(target: ModelSelectorProviderBadgeTarget): readonly unknown[] {
    const children = target.listContainer?.children;
    if (!Array.isArray(children)) return [];
    return children;
}

function highlightSelectedProviderBadge(
    target: ModelSelectorProviderBadgeTarget,
    theme: ThemeInstance,
): void {
    if (!getUiTweaksPatchState().highlightSelectedModelProvider) return;

    const selectedModel = getSelectedModelItem(target);
    if (selectedModel === undefined) return;

    const selectedModelText = theme.fg("accent", selectedModel.id);
    const mutedProviderBadge = theme.fg("muted", `[${selectedModel.provider}]`);
    const accentProviderBadge = theme.fg("accent", `[${selectedModel.provider}]`);

    for (const child of getListChildren(target)) {
        if (!isTextLike(child)) continue;
        const text = child.text;
        if (typeof text !== "string") continue;
        if (!text.includes(selectedModelText) || !text.includes(mutedProviderBadge)) continue;
        child.setText?.(text.replace(mutedProviderBadge, accentProviderBadge));
        return;
    }
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

async function loadThemeModule(): Promise<ThemeModule> {
    const distDir = await resolvePiDistDir();
    const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;
    const themeModule = (await import(themePath)) as ThemeModule;
    return themeModule;
}

/**
 * Sets whether the selected model row should accent its provider badge.
 */
export function setHighlightSelectedModelProvider(enabled: boolean): void {
    getUiTweaksPatchState().highlightSelectedModelProvider = enabled;
}

/**
 * Installs an idempotent patch that highlights the selected model row's provider badge.
 */
export async function installModelSelectorProviderBadgePatch(
    prototype: ModelSelectorProviderBadgeTarget = ModelSelectorComponent.prototype as unknown as ModelSelectorProviderBadgeTarget,
    providedTheme?: ThemeInstance,
): Promise<void> {
    try {
        let theme = providedTheme;
        theme ??= (await loadThemeModule()).theme;
        if (theme === undefined) {
            warnModelSelectorProviderBadgePatchUnavailable();
            return;
        }

        if (prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY] === true) return;

        const originalUpdateListValue: unknown = Reflect.get(prototype, "updateList");
        if (typeof originalUpdateListValue !== "function") {
            warnModelSelectorProviderBadgePatchUnavailable(new Error("missing updateList"));
            return;
        }

        const originalUpdateList =
            originalUpdateListValue as ModelSelectorProviderBadgeTarget["updateList"];
        prototype.updateList = function selectedProviderBadgeUpdateList(
            this: ModelSelectorProviderBadgeTarget,
        ): void {
            originalUpdateList?.call(this);
            highlightSelectedProviderBadge(this, theme);
        };
        prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY] = true;
    } catch (error: unknown) {
        warnModelSelectorProviderBadgePatchUnavailable(error);
    }
}
