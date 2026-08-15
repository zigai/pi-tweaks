import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import {
    installLinkedMethodPatch,
    loadPiInternalModule,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

const MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY = Symbol.for(
    "zigai.pi-ui-tweaks.model-selector-provider-badge-patch",
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
    [MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY]?: ModelSelectorProviderBadgeRecord;
    filteredModels?: unknown;
    listContainer?: ContainerLike;
    selectedIndex?: unknown;
    updateList?: (this: ModelSelectorProviderBadgeTarget) => void;
};

type ThemeInstance = {
    fg(color: string, text: string): string;
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

export type ModelSelectorProviderBadgeConfig = {
    readonly highlightSelectedModelProvider: boolean;
};
export type ModelSelectorProviderBadgeHandle = {
    update(config: ModelSelectorProviderBadgeConfig): void;
    dispose(): void;
};
type UpdateList = (this: ModelSelectorProviderBadgeTarget) => void;
type ModelSelectorProviderBadgeRecord = {
    readonly original: UpdateList;
    readonly patch: LinkedMethodPatchHandle<ModelSelectorProviderBadgeTarget, [], void>;
    readonly handle: ModelSelectorProviderBadgeHandle;
};
let currentProviderBadgeConfig: ModelSelectorProviderBadgeConfig = {
    highlightSelectedModelProvider: true,
};
function highlightSelectedProviderBadge(
    target: ModelSelectorProviderBadgeTarget,
    theme: ThemeInstance,
): void {
    if (!currentProviderBadgeConfig.highlightSelectedModelProvider) return;

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

async function loadTheme(): Promise<ThemeInstance | undefined> {
    return loadPiInternalModule("modes/interactive/theme/theme.js", {
        scope: "pi-ui-tweaks",
        feature: "selected model provider badge patch",
        parse(module): ThemeInstance | undefined {
            const theme = getUnknownProperty(module, "theme");
            if ((typeof theme !== "object" && typeof theme !== "function") || theme === null)
                return undefined;
            return {
                fg(color, text): string {
                    const fg = getUnknownProperty(theme, "fg");
                    if (typeof fg !== "function") return text;
                    const styled: unknown = Reflect.apply(fg, theme, [color, text]);
                    if (typeof styled === "string") return styled;
                    return text;
                },
            };
        },
    });
}

/** Installs or updates the selected-provider badge patch. */
export async function installModelSelectorProviderBadgePatch(
    config: ModelSelectorProviderBadgeConfig,
    target: unknown = ModelSelectorComponent.prototype,
    providedTheme?: ThemeInstance,
): Promise<ModelSelectorProviderBadgeHandle> {
    if ((typeof target !== "object" && typeof target !== "function") || target === null) {
        warnModelSelectorProviderBadgePatchUnavailable();
        return { update(): void {}, dispose(): void {} };
    }
    const updateList: unknown = Reflect.get(target, "updateList");
    if (typeof updateList !== "function") {
        warnModelSelectorProviderBadgePatchUnavailable(new Error("missing updateList"));
        return { update(): void {}, dispose(): void {} };
    }
    // SAFETY: The runtime guard proves updateList is callable.
    const prototype = target as ModelSelectorProviderBadgeTarget & { updateList: UpdateList };
    const installed = prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY];
    if (installed !== undefined) {
        installed.handle.update(config);
        return installed.handle;
    }
    const theme = providedTheme ?? (await loadTheme());
    if (theme === undefined) return { update(): void {}, dispose(): void {} };
    currentProviderBadgeConfig = config;
    const patch = installLinkedMethodPatch(
        prototype,
        "updateList",
        (predecessor) =>
            function selectedProviderBadgeUpdateList(this: ModelSelectorProviderBadgeTarget): void {
                predecessor.call(this);
                highlightSelectedProviderBadge(this, theme);
            },
    );
    let disposed = false;
    const handle: ModelSelectorProviderBadgeHandle = {
        update(next): void {
            if (!disposed) currentProviderBadgeConfig = next;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            patch.dispose();
            if (prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY]?.handle === handle) {
                delete prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY];
            }
        },
    };
    prototype[MODEL_SELECTOR_PROVIDER_BADGE_PATCH_KEY] = {
        original: patch.predecessor,
        patch,
        handle,
    };
    return handle;
}
