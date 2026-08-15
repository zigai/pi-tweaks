export const TREE_TIMESTAMP_MODE_KEY = Symbol.for("zigai.pi.tree-timestamps.mode");
export const TREE_PREVIEW_ENABLED_KEY = Symbol.for("zigai.pi.tree-timestamps.preview-enabled");
import {
    getPersistedMaxVisibleLines,
    getPersistedMode,
    getPersistedPreviewEnabled,
    isTreeTimestampMode,
} from "./settings.ts";
import type { FlatTreeNode, TreeNode } from "./tree-node.ts";
import type { TreeTimestampMode } from "./timestamps.ts";

export type TreeListInstance = {
    activePathIds?: Set<string>;
    filteredNodes?: FlatTreeNode[];
    foldedNodes?: Set<string>;
    maxVisibleLines?: number;
    multipleRoots?: boolean;
    selectedIndex?: number;
    showLabelTimestamps?: boolean;
    formatLabelTimestamp?: (timestamp: string) => string;
    getStatusLabels?: () => string;
    handleInput?: (keyData: string) => void;
    isFoldable?: (entryId: string) => boolean;
    getEntryDisplayText?: (node: TreeNode, isSelected: boolean) => string;
};

export function setTreeTimestampMode(treeList: TreeListInstance, mode: TreeTimestampMode): void {
    (treeList as TreeListInstance & { [TREE_TIMESTAMP_MODE_KEY]?: TreeTimestampMode })[
        TREE_TIMESTAMP_MODE_KEY
    ] = mode;
    treeList.showLabelTimestamps = false;
}

export function getTreeTimestampMode(treeList: TreeListInstance): TreeTimestampMode {
    const current = (treeList as TreeListInstance & { [TREE_TIMESTAMP_MODE_KEY]?: unknown })[
        TREE_TIMESTAMP_MODE_KEY
    ];

    if (isTreeTimestampMode(current)) {
        treeList.showLabelTimestamps = false;
        return current;
    }

    const initialMode = getPersistedMode();
    setTreeTimestampMode(treeList, initialMode);
    return initialMode;
}

export function setTreePreviewEnabled(treeList: TreeListInstance, enabled: boolean): void {
    (treeList as TreeListInstance & { [TREE_PREVIEW_ENABLED_KEY]?: boolean })[
        TREE_PREVIEW_ENABLED_KEY
    ] = enabled;
}

export function applyConfiguredMaxVisibleLines(treeList: TreeListInstance): void {
    const configured = getPersistedMaxVisibleLines();
    if (configured === null) {
        return;
    }
    treeList.maxVisibleLines = configured;
}

export function getTreePreviewEnabled(treeList: TreeListInstance): boolean {
    const current = (treeList as TreeListInstance & { [TREE_PREVIEW_ENABLED_KEY]?: unknown })[
        TREE_PREVIEW_ENABLED_KEY
    ];

    if (typeof current === "boolean") {
        return current;
    }

    const initialEnabled = getPersistedPreviewEnabled();
    setTreePreviewEnabled(treeList, initialEnabled);
    return initialEnabled;
}
