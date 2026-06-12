/**
 * Tree Timestamps Extension
 *
 * Adds per-entry timestamps to /tree with three modes:
 * - off
 * - relative (e.g. 5m ago)
 * - absolute (e.g. 4/19 13:37)
 *
 * Behavior:
 * - Shift+T inside /tree cycles: off -> relative -> absolute -> off
 * - The selected mode is persisted in ~/.pi/agent/settings.json
 *
 * This intentionally repurposes the built-in label-timestamp toggle so /tree can
 * show timestamps for every visible entry instead of only labeled nodes.
 */

import { getAgentDir, keyText, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    getKeybindings,
    Text,
    TruncatedText,
    truncateToWidth,
    wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
    closeSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type TreeSelectorModule = {
    TreeSelectorComponent: new (
        entries: unknown[],
        selectedId: string | null,
        height: number,
        onSelect: () => undefined,
        onCancel: () => undefined,
        onLabel: () => undefined,
        onDelete: undefined,
        onFork: undefined,
    ) => { getTreeList?: () => unknown };
};

type ThemeModule = {
    initTheme: (name: string | undefined, force: boolean) => void;
    theme: {
        fg: (role: string, text: string) => string;
        bg: (role: string, text: string) => string;
        bold: (text: string) => string;
    };
};

type TreeTimestampMode = "off" | "relative" | "absolute";

type TreeEntry = {
    id: string;
    parentId?: string | null;
    timestamp?: string;
    type?: string;
    message?: {
        role?: string;
        content?: unknown;
        command?: string;
        toolName?: string;
        stopReason?: string;
        errorMessage?: string;
    };
    content?: unknown;
    customType?: string;
    summary?: string;
    tokensBefore?: number;
    modelId?: string;
    thinkingLevel?: string;
    label?: string;
    name?: string;
};

type TreeNode = {
    entry: TreeEntry;
    label?: string;
    labelTimestamp?: string;
};

type FlatTreeNode = {
    node: TreeNode;
    indent: number;
    showConnector: boolean;
    isLast: boolean;
    gutters: Array<{ position: number; show: boolean }>;
    isVirtualRootChild: boolean;
};

type TreeListInstance = {
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

const DEFAULT_MODE: TreeTimestampMode = "relative";
const SETTINGS_KEY = "treeTimestampMode";
const PREVIEW_SETTINGS_KEY = "treeSelectedPreview";
const MAX_VISIBLE_LINES_SETTINGS_KEY = "treeMaxVisibleLines";
const PREVIEW_FULL_HEIGHT_SETTINGS_KEY = "treePreviewFullHeight";
const MIN_VISIBLE_LINES = 5;
const PATCH_KEY = Symbol.for("zigai.pi.tree-timestamps.patched");
const TREE_HELP_PATCH_KEY = Symbol.for("zigai.pi.tree-timestamps.help-patched");
const TREE_TITLE_PATCH_KEY = Symbol.for("zigai.pi.tree-timestamps.title-patched");
const PREVIEW_TOGGLE_KEY = "P";
const PREVIEW_TOGGLE_HINT = "shift+p";

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
const TREE_TIMESTAMP_MODE_KEY = Symbol.for("zigai.pi.tree-timestamps.mode");
const TREE_PREVIEW_ENABLED_KEY = Symbol.for("zigai.pi.tree-timestamps.preview-enabled");
const MODE_SEQUENCE: TreeTimestampMode[] = ["off", "relative", "absolute"];
const MIN_PREVIEW_TOTAL_WIDTH = 80;
const MIN_PREVIEW_WIDTH = 24;
const MIN_TREE_WIDTH = 32;
const SETTINGS_LOCK_TIMEOUT_MS = 5_000;
const STALE_SETTINGS_LOCK_MS = 30_000;

let cachedMode: TreeTimestampMode | null = null;
let cachedPreviewEnabled: boolean | null = null;
let cachedMaxVisibleLines: number | null | undefined;
let cachedPreviewFullHeight: boolean | undefined;

function isTreeTimestampMode(value: unknown): value is TreeTimestampMode {
    return value === "off" || value === "relative" || value === "absolute";
}

function getSettingsPath(): string {
    return join(getAgentDir(), "settings.json");
}

function getErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string") return code;
    return undefined;
}

function throwError(error: unknown): never {
    if (error instanceof Error) throw error;
    throw new Error(String(error));
}

function sleepSync(ms: number): void {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function withSettingsLock<T>(settingsPath: string, fn: () => T): T {
    const lockPath = `${settingsPath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true });

    const start = Date.now();
    while (true) {
        try {
            const fd = openSync(lockPath, "wx");
            try {
                writeFileSync(
                    fd,
                    `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
                    "utf8",
                );
            } catch {
                // Ignore best-effort lock metadata.
            }

            try {
                return fn();
            } finally {
                try {
                    closeSync(fd);
                } catch {
                    // Ignore cleanup failures.
                }
                try {
                    unlinkSync(lockPath);
                } catch {
                    // Ignore cleanup failures.
                }
            }
        } catch (error: unknown) {
            if (getErrorCode(error) !== "EEXIST") throwError(error);

            try {
                const stat = statSync(lockPath);
                if (Date.now() - stat.mtimeMs > STALE_SETTINGS_LOCK_MS) {
                    unlinkSync(lockPath);
                    continue;
                }
            } catch {
                // Ignore stale-lock checks.
            }

            if (Date.now() - start > SETTINGS_LOCK_TIMEOUT_MS) {
                throw new Error(`Timed out waiting for lock: ${lockPath}`);
            }
            sleepSync(40 + Math.random() * 80);
        }
    }
}

function atomicWriteUtf8Sync(filePath: string, content: string): void {
    mkdirSync(dirname(filePath), { recursive: true });

    const tempPath = join(
        dirname(filePath),
        `.${filePath.split(/[\\/]/).pop() ?? "settings.json"}.tmp.${process.pid}.${Math.random()
            .toString(16)
            .slice(2)}`,
    );

    writeFileSync(tempPath, content, "utf8");

    try {
        renameSync(tempPath, filePath);
    } catch (error: unknown) {
        const code = getErrorCode(error);
        if (code === "EEXIST" || code === "EPERM") {
            try {
                unlinkSync(filePath);
            } catch {
                // Ignore missing target before retrying the rename.
            }
            renameSync(tempPath, filePath);
            return;
        }
        try {
            unlinkSync(tempPath);
        } catch {
            // Ignore cleanup failures.
        }
        throwError(error);
    }
}

function readSettingsObject(options?: { throwOnInvalid?: boolean }): Record<string, unknown> {
    const settingsPath = getSettingsPath();
    try {
        const raw = readFileSync(settingsPath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return { ...parsed };
        }
        if (options?.throwOnInvalid === true) {
            throw new Error(`${settingsPath} must contain a JSON object.`);
        }
    } catch (error: unknown) {
        if (getErrorCode(error) === "ENOENT") return {};
        if (options?.throwOnInvalid === true) throwError(error);
        // Ignore malformed settings files while reading and fall back to defaults.
    }

    return {};
}

function updateSettingsObject(update: (settings: Record<string, unknown>) => void): void {
    const settingsPath = getSettingsPath();
    withSettingsLock(settingsPath, () => {
        const settings = readSettingsObject({ throwOnInvalid: true });
        update(settings);
        atomicWriteUtf8Sync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    });
}

function getPersistedMode(): TreeTimestampMode {
    if (cachedMode !== null) return cachedMode;

    const settings = readSettingsObject();
    const configured = settings[SETTINGS_KEY];
    cachedMode = DEFAULT_MODE;
    if (isTreeTimestampMode(configured)) {
        cachedMode = configured;
    }
    return cachedMode;
}

function getPersistedPreviewEnabled(): boolean {
    if (cachedPreviewEnabled !== null) return cachedPreviewEnabled;

    const settings = readSettingsObject();
    cachedPreviewEnabled = settings[PREVIEW_SETTINGS_KEY] === true;
    return cachedPreviewEnabled;
}

function getPersistedMaxVisibleLines(): number | null {
    if (cachedMaxVisibleLines !== undefined) return cachedMaxVisibleLines;

    const settings = readSettingsObject();
    const configured = settings[MAX_VISIBLE_LINES_SETTINGS_KEY];
    cachedMaxVisibleLines = null;
    if (typeof configured === "number" && Number.isFinite(configured)) {
        cachedMaxVisibleLines = Math.max(MIN_VISIBLE_LINES, Math.floor(configured));
    }
    return cachedMaxVisibleLines;
}

function getPersistedPreviewFullHeight(): boolean {
    if (cachedPreviewFullHeight !== undefined) return cachedPreviewFullHeight;

    const settings = readSettingsObject();
    cachedPreviewFullHeight = settings[PREVIEW_FULL_HEIGHT_SETTINGS_KEY] !== false;
    return cachedPreviewFullHeight;
}

function getConfiguredThemeName(): string | undefined {
    const settings = readSettingsObject();
    if (typeof settings.theme === "string") {
        return settings.theme;
    }
    return undefined;
}

function warnSettingsWriteFailed(error: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(`[pi-tree] settings update was not saved${suffix}`);
}

function persistPreviewEnabled(enabled: boolean): void {
    try {
        updateSettingsObject((settings) => {
            settings[PREVIEW_SETTINGS_KEY] = enabled;
        });
        cachedPreviewEnabled = enabled;
    } catch (error: unknown) {
        warnSettingsWriteFailed(error);
    }
}

function persistMode(mode: TreeTimestampMode): void {
    try {
        updateSettingsObject((settings) => {
            settings[SETTINGS_KEY] = mode;
        });
        cachedMode = mode;
    } catch (error: unknown) {
        warnSettingsWriteFailed(error);
    }
}

function cycleMode(mode: TreeTimestampMode): TreeTimestampMode {
    const index = MODE_SEQUENCE.indexOf(mode);
    return MODE_SEQUENCE[(index + 1) % MODE_SEQUENCE.length] ?? DEFAULT_MODE;
}

function formatAbsoluteTimestamp(timestamp: string | undefined): string {
    if (timestamp === undefined || timestamp.length === 0) return "";

    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return "";

    const now = new Date();
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const time = `${hours}:${minutes}`;

    if (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
    ) {
        return time;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    if (date.getFullYear() === now.getFullYear()) {
        return `${month}/${day} ${time}`;
    }

    const year = date.getFullYear().toString().slice(-2);
    return `${year}/${month}/${day} ${time}`;
}

function formatRelativeTimestamp(timestamp: string | undefined): string {
    if (timestamp === undefined || timestamp.length === 0) return "";

    const date = new Date(timestamp);
    const then = date.getTime();
    if (!Number.isFinite(then)) return "";

    const diffMs = Math.max(0, Date.now() - then);
    const diffSeconds = Math.floor(diffMs / 1000);

    if (diffSeconds < 60) {
        return `${Math.max(1, diffSeconds)}s ago`;
    }

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }

    if (diffDays < 30) {
        return `${Math.floor(diffDays / 7)}w ago`;
    }

    if (diffDays < 365) {
        return `${Math.max(1, Math.floor(diffDays / 30.4375))}mo ago`;
    }

    return `${Math.max(1, Math.floor(diffDays / 365.25))}y ago`;
}

function formatEntryTimestamp(
    timestamp: string | undefined,
    mode: Exclude<TreeTimestampMode, "off">,
): string {
    if (mode === "absolute") {
        return formatAbsoluteTimestamp(timestamp);
    }
    return formatRelativeTimestamp(timestamp);
}

function setTreeTimestampMode(treeList: TreeListInstance, mode: TreeTimestampMode): void {
    (treeList as TreeListInstance & { [TREE_TIMESTAMP_MODE_KEY]?: TreeTimestampMode })[
        TREE_TIMESTAMP_MODE_KEY
    ] = mode;
    treeList.showLabelTimestamps = false;
}

function getTreeTimestampMode(treeList: TreeListInstance): TreeTimestampMode {
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

function setTreePreviewEnabled(treeList: TreeListInstance, enabled: boolean): void {
    (treeList as TreeListInstance & { [TREE_PREVIEW_ENABLED_KEY]?: boolean })[
        TREE_PREVIEW_ENABLED_KEY
    ] = enabled;
}

function applyConfiguredMaxVisibleLines(treeList: TreeListInstance): void {
    const configured = getPersistedMaxVisibleLines();
    if (configured === null) {
        return;
    }
    treeList.maxVisibleLines = configured;
}

function getTreePreviewEnabled(treeList: TreeListInstance): boolean {
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

function normalizePreviewText(value: string): string {
    return value
        .replace(/[\t ]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function extractTextContent(content: unknown, maxLength: number): string {
    if (typeof content === "string") {
        return content.slice(0, maxLength);
    }

    if (!Array.isArray(content)) {
        return "";
    }

    let result = "";
    for (const block of content) {
        if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string"
        ) {
            result += block.text;
            if (result.length >= maxLength) {
                return result.slice(0, maxLength);
            }
        }
    }

    return result;
}

function getPreviewText(node: TreeNode | undefined): string {
    const entry = node?.entry;
    if (entry === undefined) {
        return "";
    }

    if (entry.type === undefined) {
        return "";
    }

    switch (entry.type) {
        case "message": {
            const message = entry.message;
            const textContent = normalizePreviewText(extractTextContent(message?.content, 4000));
            if (textContent.length > 0) {
                return textContent;
            }
            if (message?.role === "bashExecution") {
                return normalizePreviewText(message.command ?? "");
            }
            if (message?.errorMessage !== undefined && message.errorMessage.length > 0) {
                return normalizePreviewText(message.errorMessage);
            }
            if (message?.stopReason === "aborted") {
                return "(aborted)";
            }
            if (message?.role === "toolResult") {
                return `[${message.toolName ?? "tool"}]`;
            }
            return "(no content)";
        }
        case "custom_message":
            return normalizePreviewText(extractTextContent(entry.content, 4000));
        case "branch_summary":
            return normalizePreviewText(entry.summary ?? "");
        case "compaction":
            return `compaction: ${Math.round((entry.tokensBefore ?? 0) / 1000)}k tokens`;
        case "model_change":
            return `model: ${entry.modelId ?? ""}`;
        case "thinking_level_change":
            return `thinking: ${entry.thinkingLevel ?? ""}`;
        case "custom":
            return `custom: ${entry.customType ?? ""}`;
        case "label":
            return `label: ${entry.label ?? "(cleared)"}`;
        case "session_info":
            return `title: ${entry.name ?? "empty"}`;
        default:
            return "";
    }
}

function calculatePreviewLayout(width: number): { leftWidth: number; rightWidth: number } | null {
    if (width < MIN_PREVIEW_TOTAL_WIDTH) {
        return null;
    }

    const separatorWidth = 3;
    const preferredLeftWidth = Math.max(MIN_TREE_WIDTH, Math.floor(width * 0.42));
    const maxLeftWidth = width - separatorWidth - MIN_PREVIEW_WIDTH;
    if (maxLeftWidth < MIN_TREE_WIDTH) {
        return null;
    }

    const leftWidth = Math.min(preferredLeftWidth, maxLeftWidth);
    return { leftWidth, rightWidth: width - separatorWidth - leftWidth };
}

function padToWidth(text: string, width: number): string {
    return truncateToWidth(text, width, "...", true);
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

function warnInternalPatchUnavailable(feature: string, error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(`[pi-tree] ${feature} unavailable; Pi internals may have changed${suffix}`);
}

async function loadTreeInternals(): Promise<[TreeSelectorModule, ThemeModule] | undefined> {
    try {
        const distDir = await resolvePiDistDir();
        const treeSelectorPath = pathToFileURL(
            join(distDir, "modes/interactive/components/tree-selector.js"),
        ).href;
        const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;

        return (await Promise.all([import(treeSelectorPath), import(themePath)])) as [
            TreeSelectorModule,
            ThemeModule,
        ];
    } catch (error: unknown) {
        warnInternalPatchUnavailable("tree selector patch", error);
        return undefined;
    }
}

function patchTreeHeaderText(): void {
    const globalState = globalThis as typeof globalThis & {
        [TREE_HELP_PATCH_KEY]?: boolean;
        [TREE_TITLE_PATCH_KEY]?: boolean;
    };

    if (globalState[TREE_TITLE_PATCH_KEY] !== true) {
        const textPrototype = Text.prototype as unknown as {
            render?: (width: number) => string[];
            text?: string;
        };
        const originalTextRender = textPrototype.render;
        if (typeof originalTextRender === "function") {
            textPrototype.render = function patchedTextRender(
                this: { text?: string },
                width: number,
            ) {
                if (this.text?.includes("  Session Tree") === true) {
                    return [];
                }
                return originalTextRender.call(this, width);
            };
            globalState[TREE_TITLE_PATCH_KEY] = true;
        } else {
            warnInternalPatchUnavailable("tree title patch");
        }
    }

    if (globalState[TREE_HELP_PATCH_KEY] === true) return;

    const truncatedTextPrototype = TruncatedText.prototype as unknown as {
        render?: (width: number) => string[];
        text?: string;
    };
    const originalRender = truncatedTextPrototype.render;
    if (typeof originalRender !== "function") {
        warnInternalPatchUnavailable("tree help patch");
        return;
    }

    truncatedTextPrototype.render = function patchedRender(this: { text?: string }, width: number) {
        if (this.text?.includes("↑/↓: move.") === true) {
            this.text = `  ${getTreeHelpText()}`;
        }
        return originalRender.call(this, width);
    };

    globalState[TREE_HELP_PATCH_KEY] = true;
}

async function patchTreeSelector(): Promise<void> {
    patchTreeHeaderText();

    const globalState = globalThis as typeof globalThis & {
        [PATCH_KEY]?: boolean;
    };
    if (globalState[PATCH_KEY] === true) return;

    const internals = await loadTreeInternals();
    if (internals === undefined) return;

    const [{ TreeSelectorComponent }, { initTheme, theme }] = internals;

    initTheme(getConfiguredThemeName(), false);

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
        getTreeList?: () => TreeListInstance | undefined;
    } | null;
    const originalGetTreeList = selectorPrototype?.getTreeList;
    if (selectorPrototype !== null && typeof originalGetTreeList === "function") {
        selectorPrototype.getTreeList = function patchedGetTreeList(this: unknown) {
            const treeListInstance = originalGetTreeList.call(this);
            if (treeListInstance !== undefined) {
                applyConfiguredMaxVisibleLines(treeListInstance);
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
        applyConfiguredMaxVisibleLines(this);
        const kb = getKeybindings();
        if (kb.matches(keyData, "app.tree.toggleLabelTimestamp") === true) {
            const nextMode = cycleMode(getTreeTimestampMode(this));
            setTreeTimestampMode(this, nextMode);
            persistMode(nextMode);
            return;
        }

        if (keyData === PREVIEW_TOGGLE_KEY) {
            const nextEnabled = !getTreePreviewEnabled(this);
            setTreePreviewEnabled(this, nextEnabled);
            persistPreviewEnabled(nextEnabled);
            return;
        }

        return originalHandleInput.call(this, keyData);
    };

    treeListPrototype.getStatusLabels = function patchedGetStatusLabels(
        this: TreeListInstance,
    ): string {
        const currentMode = getTreeTimestampMode(this);
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
        if (getTreePreviewEnabled(this)) {
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
            applyConfiguredMaxVisibleLines(this);
            if (!getTreePreviewEnabled(this) || layout === null) {
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
            if (!getPersistedPreviewFullHeight()) {
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
            const currentMode = getTreeTimestampMode(this);
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

export default async function treeTimestampsExtension(pi: ExtensionAPI): Promise<void> {
    getPersistedMode();
    await patchTreeSelector();

    pi.on("session_start", async (_event, _ctx) => {
        getPersistedMode();
        await patchTreeSelector();
    });
}
