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

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

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
        typeof getUnknownProperty(value, "id") === "string" &&
        typeof getUnknownProperty(value, "provider") === "string"
    );
}

function isTextLike(value: unknown): value is TextLike {
    if (typeof value !== "object" || value === null) return false;
    return (
        typeof getUnknownProperty(value, "text") === "string" &&
        typeof getUnknownProperty(value, "setText") === "function"
    );
}

function getSelectedModelItem(target: ModelSelectorProviderBadgeTarget): ModelItemLike | undefined {
    const selectedIndex = target.selectedIndex;
    if (typeof selectedIndex !== "number") return undefined;

    const filteredModels = target.filteredModels;
    if (!isUnknownArray(filteredModels)) return undefined;

    const selectedModel = filteredModels[selectedIndex];
    if (!isModelItemLike(selectedModel)) return undefined;
    return selectedModel;
}

function getListChildren(target: ModelSelectorProviderBadgeTarget): readonly unknown[] {
    const children = target.listContainer?.children;
    if (!isUnknownArray(children)) return [];
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

async function loadThemeModule(): Promise<ThemeModule | undefined> {
    const distDir = await resolvePiDistDir();
    const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;
    const themeModule: unknown = (await import(themePath)) as unknown;
    const theme = getUnknownProperty(themeModule, "theme");
    if ((typeof theme !== "object" && typeof theme !== "function") || theme === null) {
        return undefined;
    }
    return {
        theme: {
            fg(color, text): string {
                const fg = getUnknownProperty(theme, "fg");
                if (typeof fg !== "function") return text;
                const styled: unknown = Reflect.apply(fg, theme, [color, text]) as unknown;
                if (typeof styled !== "string") return text;
                return styled;
            },
        },
    };
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
    prototype?: ModelSelectorProviderBadgeTarget,
    providedTheme?: ThemeInstance,
): Promise<void> {
    try {
        const target = prototype ?? ModelSelectorComponent.prototype;
        if ((typeof target !== "object" && typeof target !== "function") || target === null) {
            warnModelSelectorProviderBadgePatchUnavailable();
            return;
        }
        let theme = providedTheme;
        theme ??= (await loadThemeModule())?.theme;
        if (theme === undefined) {
            warnModelSelectorProviderBadgePatchUnavailable();
            return;
        }

        const originalUpdateListValue: unknown = Reflect.get(target, "updateList") as unknown;
        if (typeof originalUpdateListValue !== "function") {
            warnModelSelectorProviderBadgePatchUnavailable(new Error("missing updateList"));
            return;
        }

        // SAFETY: This adapter checked updateList before patching and consumes only the
        // optional model-selector members represented by its minimal target type.
        prototype = target as ModelSelectorProviderBadgeTarget;
        if (prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY] === true) return;

        prototype.updateList = function selectedProviderBadgeUpdateList(
            this: ModelSelectorProviderBadgeTarget,
        ): void {
            Reflect.apply(originalUpdateListValue, this, []);
            highlightSelectedProviderBadge(this, theme);
        };
        prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY] = true;
    } catch (error: unknown) {
        warnModelSelectorProviderBadgePatchUnavailable(error);
    }
}
