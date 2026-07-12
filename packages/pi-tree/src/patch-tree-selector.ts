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

type TreeListPrototype = {
    getEntryDisplayText?: NonNullable<TreeListInstance["getEntryDisplayText"]>;
    getStatusLabels: NonNullable<TreeListInstance["getStatusLabels"]>;
    handleInput: NonNullable<TreeListInstance["handleInput"]>;
    render?: (width: number) => string[];
};

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

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if (!isObject(value)) return undefined;
    return Reflect.get(value, key) as unknown;
}

function isTreeListInstance(value: unknown): value is TreeListInstance {
    return (
        isObject(value) &&
        typeof getUnknownProperty(value, "handleInput") === "function" &&
        typeof getUnknownProperty(value, "getStatusLabels") === "function"
    );
}

function isTreeListPrototype(value: unknown): value is TreeListPrototype {
    if (!isObject(value)) return false;
    const getEntryDisplayText = getUnknownProperty(value, "getEntryDisplayText");
    const render = getUnknownProperty(value, "render");
    return (
        typeof getUnknownProperty(value, "handleInput") === "function" &&
        typeof getUnknownProperty(value, "getStatusLabels") === "function" &&
        (getEntryDisplayText === undefined || typeof getEntryDisplayText === "function") &&
        (render === undefined || typeof render === "function")
    );
}

function setTreePatchState(settings: TreePatchSettings): TreePatchState {
    const existing: unknown = Reflect.get(globalThis, TREE_PATCH_STATE) as unknown;
    if (typeof existing === "object" && existing !== null) {
        Object.assign(existing, settings);
        // SAFETY: The private global-symbol slot is written only by this function with
        // the complete settings shape; TypeScript cannot represent that symbol invariant.
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
    const current: unknown = Reflect.get(treeList, TREE_TIMESTAMP_MODE_KEY) as unknown;

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
    const current: unknown = Reflect.get(treeList, TREE_PREVIEW_ENABLED_KEY) as unknown;

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

    if (Reflect.get(globalThis, PATCH_KEY) === true) return;

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
    const selectorPrototype: unknown = Object.getPrototypeOf(selector);
    if (!isObject(selectorPrototype)) return;

    const originalGetTreeList = getUnknownProperty(selectorPrototype, "getTreeList");
    if (typeof originalGetTreeList !== "function") return;
    const treeListValue: unknown = Reflect.apply(originalGetTreeList, selector, []);
    if (!isTreeListInstance(treeListValue)) return;
    const treeList = treeListValue;
    const treeListPrototypeValue: unknown = Object.getPrototypeOf(treeList);
    if (!isTreeListPrototype(treeListPrototypeValue)) return;
    const treeListPrototype = treeListPrototypeValue;

    const addChild = getUnknownProperty(selectorPrototype, "addChild");
    if (typeof addChild === "function") {
        // SAFETY: The dynamic selector prototype adapter verifies the addChild method
        // required by the header patch before passing the smallest patch target onward.
        patchHeaderText(selectorPrototype as TreeHeaderPatchTarget);
    }
    Reflect.set(selectorPrototype, "getTreeList", function patchedGetTreeList(this: unknown) {
        const treeListInstance: unknown = Reflect.apply(originalGetTreeList, this, []);
        if (isTreeListInstance(treeListInstance)) {
            applyConfiguredMaxVisibleLinesFromState(treeListInstance, patchState);
        }
        return treeListInstance;
    });

    const originalHandleInput = treeListPrototype.handleInput;
    const originalGetStatusLabels = treeListPrototype.getStatusLabels;
    const originalGetEntryDisplayText = treeListPrototype.getEntryDisplayText;
    const originalRender = treeListPrototype.render;

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

    Reflect.set(globalThis, PATCH_KEY, true);
}
