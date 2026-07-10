import { keyText } from "@earendil-works/pi-coding-agent";

import { PREVIEW_TOGGLE_HINT, TREE_TITLE_PATCH_KEY } from "./constants.ts";
import { warnInternalPatchUnavailable } from "./internal-imports.ts";

const TREE_TITLE_TEXT = "  Session Tree";
const LEGACY_TREE_HELP_TEXT = "↑/↓: move.";

type ComponentLike = {
    invalidate(): void;
    render(width: number): string[];
};

type AddChild = (this: TreeHeaderPatchTarget, component: ComponentLike) => void;

export type TreeHeaderPatchTarget = {
    addChild: AddChild;
};

type TreeHeaderPatchRecord = {
    readonly originalAddChild: AddChild;
    readonly patchedAddChild: AddChild;
    readonly prototype: TreeHeaderPatchTarget;
};

type TreeHeaderPatchState = typeof globalThis & {
    [TREE_TITLE_PATCH_KEY]?: TreeHeaderPatchRecord | true;
};

function formatTreeHelpKey(key: string): string {
    return key
        .replaceAll("ctrl+left/alt+left", "ctrl/alt+←")
        .replaceAll("ctrl+right/alt+right", "ctrl/alt+→")
        .replaceAll("left", "←")
        .replaceAll("right", "→")
        .replaceAll("up", "↑")
        .replaceAll("down", "↓");
}

function treeHelpKey(keybinding: Parameters<typeof keyText>[0]): string {
    return formatTreeHelpKey(keyText(keybinding));
}

function getTreeHelpText(): string {
    return [
        "↑/↓: move",
        "←/→: page",
        `${treeHelpKey("app.tree.foldOrUp")}: fold/up`,
        `${treeHelpKey("app.tree.unfoldOrDown")}: unfold/down`,
        `${treeHelpKey("app.tree.editLabel")}: label`,
        `${treeHelpKey("app.tree.filter.cycleForward")}: filter`,
        `${treeHelpKey("app.tree.toggleLabelTimestamp")}: time`,
        `${PREVIEW_TOGGLE_HINT}: preview`,
    ].join("  •  ");
}

function componentText(component: ComponentLike): string | undefined {
    const text: unknown = Reflect.get(component, "text");
    if (typeof text !== "string") return undefined;
    return text;
}

function isTreeTitle(component: ComponentLike): boolean {
    return componentText(component)?.includes(TREE_TITLE_TEXT) === true;
}

function updateLegacyTreeHelp(component: ComponentLike): void {
    if (componentText(component)?.includes(LEGACY_TREE_HELP_TEXT) !== true) return;
    Reflect.set(component, "text", `  ${getTreeHelpText()}`);
}

/** Patches only TreeSelectorComponent children, leaving global Text rendering untouched. */
export function patchTreeHeaderText(prototype: TreeHeaderPatchTarget): void {
    const globalState = globalThis as TreeHeaderPatchState;
    if (globalState[TREE_TITLE_PATCH_KEY] !== undefined) return;

    const originalAddChildValue: unknown = Reflect.get(prototype, "addChild");
    if (typeof originalAddChildValue !== "function") {
        warnInternalPatchUnavailable("tree header patch");
        return;
    }
    // SAFETY: The runtime guard verifies TreeSelectorComponent's inherited addChild method.
    const originalAddChild = originalAddChildValue as AddChild;
    const patchedAddChild: AddChild = function patchedTreeSelectorAddChild(component): void {
        if (isTreeTitle(component)) return;
        updateLegacyTreeHelp(component);
        originalAddChild.call(this, component);
    };

    prototype.addChild = patchedAddChild;
    globalState[TREE_TITLE_PATCH_KEY] = { originalAddChild, patchedAddChild, prototype };
}

/** Restores the TreeSelectorComponent child renderer when the extension unloads. */
export function restoreTreeHeaderText(): void {
    const globalState = globalThis as TreeHeaderPatchState;
    const patch = globalState[TREE_TITLE_PATCH_KEY];
    if (patch === undefined || patch === true) return;

    if (patch.prototype.addChild === patch.patchedAddChild) {
        patch.prototype.addChild = patch.originalAddChild;
    }
    delete globalState[TREE_TITLE_PATCH_KEY];
}
