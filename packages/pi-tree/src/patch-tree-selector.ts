import { getKeybindings, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import {
    PATCH_KEY,
    PREVIEW_TOGGLE_KEY,
    TREE_PREVIEW_ENABLED_KEY,
    TREE_TIMESTAMP_MODE_KEY,
} from "./constants.ts";
import { loadTreeInternals } from "./internal-imports.ts";
import { patchTreeHeaderText, type TreeHeaderPatchTarget } from "./patch-tree-header.ts";
import { calculatePreviewLayout, getPreviewText, padToWidth } from "./preview.ts";
import {
    getConfiguredThemeName,
    getPersistedMaxVisibleLines,
    getPersistedMode,
    getPersistedPreviewEnabled,
    getPersistedPreviewFullHeight,
    isTreeTimestampMode,
    persistMode,
    persistPreviewEnabled,
} from "./settings.ts";
import { formatEntryTimestamp, cycleMode } from "./timestamps.ts";
import { setTreePreviewEnabled, setTreeTimestampMode } from "./tree-state.ts";
import type {
    ThemeModule,
    TreeListInstance,
    TreeNode,
    TreeSelectorModule,
    TreeTimestampMode,
} from "./types.ts";

const TREE_PATCH_STATE = Symbol.for("zigai.pi-tree.patch-state");

type TreePatchState = {
    getConfiguredThemeName: () => string | undefined;
    getPersistedMode: () => TreeTimestampMode;
    getPersistedPreviewEnabled: () => boolean;
    getPersistedMaxVisibleLines: () => number | null;
    getPersistedPreviewFullHeight: () => boolean;
    persistMode: (mode: TreeTimestampMode) => void;
    persistPreviewEnabled: (enabled: boolean) => void;
};

type TreePatchSettings = TreePatchState;

type PatchTreeSelectorOptions = {
    readonly loadTreeInternals?: () => Promise<[TreeSelectorModule, ThemeModule] | undefined>;
    readonly patchTreeHeaderText?: (prototype: TreeHeaderPatchTarget) => void;
    readonly settings?: TreePatchSettings;
};

function defaultTreePatchSettings(): TreePatchSettings {
    return {
        getConfiguredThemeName,
        getPersistedMode,
        getPersistedPreviewEnabled,
        getPersistedMaxVisibleLines,
        getPersistedPreviewFullHeight,
        persistMode,
        persistPreviewEnabled,
    };
}

function setTreePatchState(settings: TreePatchSettings): TreePatchState {
    const existing = Reflect.get(globalThis, TREE_PATCH_STATE);
    if (typeof existing === "object" && existing !== null) {
        Object.assign(existing, settings);
        return existing as TreePatchState;
    }

    const patchState: TreePatchState = { ...settings };
    Reflect.set(globalThis, TREE_PATCH_STATE, patchState);
    return patchState;
}

function applyConfiguredMaxVisibleLinesFromState(
    treeList: TreeListInstance,
    patchState: TreePatchState,
): void {
    const configured = patchState.getPersistedMaxVisibleLines();
    if (configured === null) {
        return;
    }
    treeList.maxVisibleLines = configured;
}

function getTreeTimestampModeFromState(
    treeList: TreeListInstance,
    patchState: TreePatchState,
): TreeTimestampMode {
    const current = (treeList as TreeListInstance & { [TREE_TIMESTAMP_MODE_KEY]?: unknown })[
        TREE_TIMESTAMP_MODE_KEY
    ];

    if (isTreeTimestampMode(current)) {
        treeList.showLabelTimestamps = false;
        return current;
    }

    const initialMode = patchState.getPersistedMode();
    setTreeTimestampMode(treeList, initialMode);
    return initialMode;
}

function getTreePreviewEnabledFromState(
    treeList: TreeListInstance,
    patchState: TreePatchState,
): boolean {
    const current = (treeList as TreeListInstance & { [TREE_PREVIEW_ENABLED_KEY]?: unknown })[
        TREE_PREVIEW_ENABLED_KEY
    ];

    if (typeof current === "boolean") {
        return current;
    }

    const initialEnabled = patchState.getPersistedPreviewEnabled();
    setTreePreviewEnabled(treeList, initialEnabled);
    return initialEnabled;
}

export async function patchTreeSelector(options: PatchTreeSelectorOptions = {}): Promise<void> {
    const patchState = setTreePatchState(options.settings ?? defaultTreePatchSettings());
    const patchHeaderText = options.patchTreeHeaderText ?? patchTreeHeaderText;

    const loadInternals = options.loadTreeInternals ?? loadTreeInternals;
    const internals = await loadInternals();
    if (internals === undefined) return;

    const [{ TreeSelectorComponent }, { initTheme, theme }] = internals;

    initTheme(patchState.getConfiguredThemeName(), false);

    const globalState = globalThis as typeof globalThis & {
        [PATCH_KEY]?: boolean;
    };
    if (globalState[PATCH_KEY] === true) return;

    const selector = new TreeSelectorComponent(
        [],
        null,
        24,
        () => undefined,
        () => undefined,
        () => undefined,
        undefined,
        undefined,
    );
    const selectorPrototype = Object.getPrototypeOf(selector) as {
        addChild?: TreeHeaderPatchTarget["addChild"];
        getTreeList?: () => TreeListInstance | undefined;
    } | null;
    if (selectorPrototype !== null && typeof selectorPrototype.addChild === "function") {
        patchHeaderText(selectorPrototype as TreeHeaderPatchTarget);
    }
    const originalGetTreeList = selectorPrototype?.getTreeList;
    if (selectorPrototype !== null && typeof originalGetTreeList === "function") {
        selectorPrototype.getTreeList = function patchedGetTreeList(this: unknown) {
            const treeListInstance = originalGetTreeList.call(this);
            if (treeListInstance !== undefined) {
                applyConfiguredMaxVisibleLinesFromState(treeListInstance, patchState);
            }
            return treeListInstance;
        };
    }

    const treeList = selector.getTreeList?.() as TreeListInstance | undefined;
    let treeListPrototype = null;
    if (treeList) {
        treeListPrototype = Object.getPrototypeOf(treeList);
    }
    if (treeListPrototype === null) return;

    const originalHandleInput = treeListPrototype.handleInput as
        | ((keyData: string) => void)
        | undefined;
    const originalGetStatusLabels = treeListPrototype.getStatusLabels as (() => string) | undefined;
    const originalGetEntryDisplayText = treeListPrototype.getEntryDisplayText as
        | ((node: TreeNode, isSelected: boolean) => string)
        | undefined;
    const originalRender = treeListPrototype.render as ((width: number) => string[]) | undefined;

    if (
        typeof originalHandleInput !== "function" ||
        typeof originalGetStatusLabels !== "function"
    ) {
        return;
    }

    treeListPrototype.handleInput = function patchedHandleInput(
        this: TreeListInstance,
        keyData: string,
    ) {
        applyConfiguredMaxVisibleLinesFromState(this, patchState);
        const kb = getKeybindings();
        if (kb.matches(keyData, "app.tree.toggleLabelTimestamp") === true) {
            const nextMode = cycleMode(getTreeTimestampModeFromState(this, patchState));
            setTreeTimestampMode(this, nextMode);
            patchState.persistMode(nextMode);
            return;
        }

        if (keyData === PREVIEW_TOGGLE_KEY) {
            const nextEnabled = !getTreePreviewEnabledFromState(this, patchState);
            setTreePreviewEnabled(this, nextEnabled);
            patchState.persistPreviewEnabled(nextEnabled);
            return;
        }

        return originalHandleInput.call(this, keyData);
    };

    treeListPrototype.getStatusLabels = function patchedGetStatusLabels(
        this: TreeListInstance,
    ): string {
        const currentMode = getTreeTimestampModeFromState(this, patchState);
        const originalLabelTimestampFlag = this.showLabelTimestamps;
        this.showLabelTimestamps = false;

        const nativeLabels = originalGetStatusLabels.call(this);

        this.showLabelTimestamps = originalLabelTimestampFlag;

        const filterLabelByStatus = new Map<string, string>([
            ["[no-tools]", "No Tools"],
            ["[user]", "User"],
            ["[labeled]", "Labeled"],
            ["[all]", "All"],
        ]);
        let filterLabel = "Default";
        for (const [statusLabel, label] of filterLabelByStatus) {
            if (nativeLabels.includes(statusLabel)) {
                filterLabel = label;
                break;
            }
        }

        const timeLabelByMode: Record<TreeTimestampMode, string> = {
            off: "Off",
            relative: "Relative",
            absolute: "Absolute",
        };
        let previewLabel = "Off";
        if (getTreePreviewEnabledFromState(this, patchState)) {
            previewLabel = "On";
        }

        return `  Filter: ${filterLabel} | Time: ${timeLabelByMode[currentMode]} | Preview: ${previewLabel}`;
    };

    if (typeof originalRender === "function") {
        treeListPrototype.render = function patchedRender(
            this: TreeListInstance,
            width: number,
        ): string[] {
            const layout = calculatePreviewLayout(width);
            applyConfiguredMaxVisibleLinesFromState(this, patchState);
            if (!getTreePreviewEnabledFromState(this, patchState) || layout === null) {
                return originalRender.call(this, width);
            }

            const filteredNodes = this.filteredNodes ?? [];
            if (filteredNodes.length === 0) {
                return originalRender.call(this, width);
            }

            const selectedIndex = this.selectedIndex ?? 0;
            const maxVisibleLines = this.maxVisibleLines ?? filteredNodes.length;
            const startIndex = Math.max(
                0,
                Math.min(
                    selectedIndex - Math.floor(maxVisibleLines / 2),
                    filteredNodes.length - maxVisibleLines,
                ),
            );
            const endIndex = Math.min(startIndex + maxVisibleLines, filteredNodes.length);
            const selectedNode = filteredNodes[selectedIndex]?.node;
            const previewText = theme.fg("muted", getPreviewText(selectedNode));
            const previewLines = wrapTextWithAnsi(previewText, layout.rightWidth);
            const lines: string[] = [];

            const treeRowCount = Math.max(0, endIndex - startIndex);
            let rowCount = maxVisibleLines;
            if (!patchState.getPersistedPreviewFullHeight()) {
                rowCount = Math.max(treeRowCount, Math.min(maxVisibleLines, previewLines.length));
            }
            for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
                const index = startIndex + rowIndex;
                const flatNode = filteredNodes[index];
                let leftLine = "";

                if (flatNode !== undefined) {
                    const entry = flatNode.node.entry;
                    const isSelected = index === selectedIndex;
                    let cursor = "  ";
                    if (isSelected) {
                        cursor = theme.fg("accent", "› ");
                    }
                    let displayIndent = flatNode.indent;
                    if (this.multipleRoots === true) {
                        displayIndent = Math.max(0, flatNode.indent - 1);
                    }
                    let connector = "";
                    if (flatNode.showConnector && !flatNode.isVirtualRootChild) {
                        connector = "├─ ";
                        if (flatNode.isLast) {
                            connector = "└─ ";
                        }
                    }
                    let connectorPosition = -1;
                    if (connector.length > 0) {
                        connectorPosition = displayIndent - 1;
                    }
                    const totalChars = displayIndent * 3;
                    const prefixChars: string[] = [];
                    const isFolded = this.foldedNodes?.has(entry.id) === true;

                    for (let charIndex = 0; charIndex < totalChars; charIndex += 1) {
                        const level = Math.floor(charIndex / 3);
                        const posInLevel = charIndex % 3;
                        const gutter = flatNode.gutters.find((item) => item.position === level);
                        if (gutter !== undefined) {
                            let gutterChar = " ";
                            if (posInLevel === 0 && gutter.show) {
                                gutterChar = "│";
                            }
                            prefixChars.push(gutterChar);
                        } else if (connector.length > 0 && level === connectorPosition) {
                            if (posInLevel === 0) {
                                let connectorChar = "├";
                                if (flatNode.isLast) {
                                    connectorChar = "└";
                                }
                                prefixChars.push(connectorChar);
                            } else if (posInLevel === 1) {
                                const foldable = this.isFoldable?.(entry.id) === true;
                                let foldChar = "─";
                                if (foldable) {
                                    foldChar = "⊟";
                                }
                                if (isFolded) {
                                    foldChar = "⊞";
                                }
                                prefixChars.push(foldChar);
                            } else {
                                prefixChars.push(" ");
                            }
                        } else {
                            prefixChars.push(" ");
                        }
                    }

                    const prefix = prefixChars.join("");
                    const showsFoldInConnector =
                        flatNode.showConnector && !flatNode.isVirtualRootChild;
                    let foldMarker = "";
                    if (isFolded && !showsFoldInConnector) {
                        foldMarker = theme.fg("accent", "⊞ ");
                    }
                    const isOnActivePath = this.activePathIds?.has(entry.id) === true;
                    let pathMarker = "";
                    if (isOnActivePath) {
                        pathMarker = theme.fg("accent", "• ");
                    }
                    let label = "";
                    if (flatNode.node.label !== undefined && flatNode.node.label.length > 0) {
                        label = theme.fg("warning", `[${flatNode.node.label}] `);
                    }
                    let labelTimestamp = "";
                    if (
                        this.showLabelTimestamps === true &&
                        flatNode.node.label !== undefined &&
                        flatNode.node.labelTimestamp !== undefined
                    ) {
                        labelTimestamp = theme.fg(
                            "muted",
                            `${this.formatLabelTimestamp?.(flatNode.node.labelTimestamp) ?? ""} `,
                        );
                    }
                    const content = this.getEntryDisplayText?.(flatNode.node, isSelected) ?? "";
                    leftLine =
                        cursor +
                        theme.fg("dim", prefix) +
                        foldMarker +
                        pathMarker +
                        label +
                        labelTimestamp +
                        content;
                    leftLine = padToWidth(leftLine, layout.leftWidth);
                    if (isSelected) {
                        leftLine = theme.bg("selectedBg", leftLine);
                    }
                } else {
                    leftLine = padToWidth("", layout.leftWidth);
                }

                const previewLine = truncateToWidth(
                    previewLines[rowIndex] ?? "",
                    layout.rightWidth,
                );
                lines.push(
                    `${leftLine}${theme.fg("dim", " │ ")}${padToWidth(previewLine, layout.rightWidth)}`,
                );
            }

            const status = theme.fg(
                "muted",
                `  (${selectedIndex + 1}/${filteredNodes.length})${this.getStatusLabels?.() ?? ""}`,
            );
            lines.push(truncateToWidth(status, width));
            return lines;
        };
    }

    if (typeof originalGetEntryDisplayText === "function") {
        treeListPrototype.getEntryDisplayText = function patchedGetEntryDisplayText(
            this: TreeListInstance,
            node: TreeNode,
            isSelected: boolean,
        ): string {
            const content = originalGetEntryDisplayText.call(this, node, isSelected);
            const currentMode = getTreeTimestampModeFromState(this, patchState);
            if (currentMode === "off") return content;

            const formatted = formatEntryTimestamp(node?.entry?.timestamp, currentMode);
            if (formatted.length === 0) return content;

            const prefix = theme.fg("muted", `${formatted} `);
            let renderedPrefix = prefix;
            if (isSelected) {
                renderedPrefix = theme.bold(prefix);
            }
            return renderedPrefix + content;
        };
    }

    globalState[PATCH_KEY] = true;
}
