import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, setKeybindings } from "@earendil-works/pi-tui";
import { test } from "vitest";

import treeTimestampsExtension from "../src/index.ts";
import { PATCH_KEY, patchTreeSelector } from "../src/patch-tree-selector.ts";
import {
    loadTreeInternals,
    type ThemeModule,
    type TreeSelectorModule,
} from "../src/internal-imports.ts";
import type { FlatTreeNode, TreeNode } from "../src/tree-node.ts";
import type { TreeListInstance } from "../src/tree-state.ts";

const FILTER_ALL_KEY = "\x01";

type ThemeSnapshot = {
    readonly key: symbol;
    readonly descriptor: PropertyDescriptor | undefined;
};
type RuntimeThemeModule = Pick<ThemeModule, "initTheme"> & {
    stopThemeWatcher?: () => void;
};

function isRuntimeInitTheme(value: unknown): value is RuntimeThemeModule["initTheme"] {
    return typeof value === "function";
}

function isStopThemeWatcher(
    value: unknown,
): value is NonNullable<RuntimeThemeModule["stopThemeWatcher"]> {
    return typeof value === "function";
}
function isRuntimeThemeModule(value: unknown): value is RuntimeThemeModule {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
    const stopThemeWatcher = Object.getOwnPropertyDescriptor(value, "stopThemeWatcher");
    return (
        isRuntimeInitTheme(Object.getOwnPropertyDescriptor(value, "initTheme")?.value) &&
        (stopThemeWatcher === undefined || isStopThemeWatcher(stopThemeWatcher.value))
    );
}

const runtimeThemeModuleParser = {
    parse(value: unknown): RuntimeThemeModule {
        if (!isRuntimeThemeModule(value)) assert.fail("missing theme module");
        return value;
    },
};

const PI_THEME_KEYS = [
    Symbol.for("@earendil-works/pi-coding-agent:theme"),
    Symbol.for("@mariozechner/pi-coding-agent:theme"),
] as const;

function restoreThemeSnapshot(
    themeModule: RuntimeThemeModule,
    snapshots: readonly ThemeSnapshot[],
): void {
    themeModule.stopThemeWatcher?.();

    for (const snapshot of snapshots) {
        if (snapshot.descriptor !== undefined) {
            Object.defineProperty(globalThis, snapshot.key, snapshot.descriptor);
            continue;
        }
        Reflect.deleteProperty(globalThis, snapshot.key);
    }
}

async function initializePiTheme(): Promise<() => void> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const themeUrl = pathToFileURL(
        path.join(path.dirname(codingAgentEntry), "modes/interactive/theme/theme.js"),
    ).href;
    // Pi's unexported theme module must be loaded from the runtime-resolved package installation.
    const themeModule = runtimeThemeModuleParser.parse(await import(themeUrl));

    const snapshots: ThemeSnapshot[] = PI_THEME_KEYS.map((key) => ({
        key,
        descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
    }));
    try {
        themeModule.initTheme(undefined, false);
    } catch (cause) {
        restoreThemeSnapshot(themeModule, snapshots);
        throw cause;
    }

    return (): void => {
        restoreThemeSnapshot(themeModule, snapshots);
    };
}

class FakeTreeList implements TreeListInstance {
    filteredNodes: FlatTreeNode[] = [];
    handledInputs: string[] = [];
    maxVisibleLines: number | undefined;
    selectedIndex = 0;

    showLabelTimestamps = false;

    handleInput(keyData: string): void {
        this.handledInputs.push(keyData);
    }

    getStatusLabels(): string {
        return "";
    }

    getEntryDisplayText(_node: TreeNode, _isSelected: boolean): string {
        return "entry";
    }

    render(width: number): string[] {
        return [`native:${width}`];
    }
}

class FakeTreeSelectorComponent {
    readonly list = new FakeTreeList();

    getTreeList(): FakeTreeList {
        return this.list;
    }
}

class InvalidTreeSelectorComponent {
    readonly list = {};

    getTreeList() {
        return this.list;
    }
}

class NullTreeSelectorComponent {
    getTreeList(): null {
        return null;
    }
}

function fakeTreeInternals(
    themeNames: Array<string | undefined>,
): [TreeSelectorModule, ThemeModule] {
    return [
        {
            TreeSelectorComponent: FakeTreeSelectorComponent,
        },
        {
            initTheme(name: string | undefined): void {
                themeNames.push(name);
            },
            theme: {
                fg(_role: string, text: string): string {
                    return text;
                },
                bg(_role: string, text: string): string {
                    return text;
                },
                bold(text: string): string {
                    return text;
                },
            },
        },
    ];
}

type RuntimeTreeList = {
    readonly maxVisibleLines?: number;
    getEntryDisplayText(node: TreeNode, isSelected: boolean): string;
    getStatusLabels(): string;
    handleInput(keyData: string): void;
    render(width: number): string[];
};

type RuntimeTreeSelectorInstance = InstanceType<TreeSelectorModule["TreeSelectorComponent"]>;

type RuntimeGetTreeList = (this: RuntimeTreeSelectorInstance) => object;

function isRuntimeGetTreeList(value: unknown): value is RuntimeGetTreeList {
    return typeof value === "function";
}

type RuntimeTreeSelectorPrototype = {
    readonly getTreeList: RuntimeGetTreeList;
};

function isRuntimeTreeSelectorPrototype(value: unknown): value is RuntimeTreeSelectorPrototype {
    if (typeof value !== "object" || value === null) return false;
    return isRuntimeGetTreeList(Object.getOwnPropertyDescriptor(value, "getTreeList")?.value);
}

function isRuntimeObjectIdentity(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function getRuntimePropertyDescriptor<Value extends object>(
    value: Value,
    key: PropertyKey,
): PropertyDescriptor | undefined {
    let owner: object | null = value;
    while (owner !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor !== undefined) return descriptor;
        const parent: unknown = Object.getPrototypeOf(owner);
        if (!isRuntimeObjectIdentity(parent)) return undefined;
        owner = parent;
    }
    return undefined;
}

function isRuntimeEntryDisplayText(
    value: unknown,
): value is RuntimeTreeList["getEntryDisplayText"] {
    return typeof value === "function";
}

function isRuntimeStatusLabels(value: unknown): value is RuntimeTreeList["getStatusLabels"] {
    return typeof value === "function";
}

function isRuntimeHandleInput(value: unknown): value is RuntimeTreeList["handleInput"] {
    return typeof value === "function";
}

function isRuntimeRender(value: unknown): value is RuntimeTreeList["render"] {
    return typeof value === "function";
}

function isNumber(value: unknown): value is number {
    return typeof value === "number";
}
function isRuntimeTreeList(value: unknown): value is RuntimeTreeList {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
    const maxVisibleLines = getRuntimePropertyDescriptor(value, "maxVisibleLines");
    return (
        isRuntimeEntryDisplayText(
            getRuntimePropertyDescriptor(value, "getEntryDisplayText")?.value,
        ) &&
        isRuntimeStatusLabels(getRuntimePropertyDescriptor(value, "getStatusLabels")?.value) &&
        isRuntimeHandleInput(getRuntimePropertyDescriptor(value, "handleInput")?.value) &&
        isRuntimeRender(getRuntimePropertyDescriptor(value, "render")?.value) &&
        (maxVisibleLines === undefined || isNumber(maxVisibleLines.value))
    );
}

type RecordedExtensionLifecycle = {
    readonly api: ExtensionAPI;
    readonly handlers: Map<string, unknown>;
};

function createRecordedExtensionLifecycle(): RecordedExtensionLifecycle {
    const handlers = new Map<string, unknown>();
    const api: Pick<ExtensionAPI, "on"> = {
        on(event, handler): void {
            handlers.set(event, handler);
        },
    };

    // SAFETY: The extension under test consumes only ExtensionAPI.on, implemented above
    // with Pi's exact contextual signature; no other ExtensionAPI member is accessed.
    return { api: api as ExtensionAPI, handlers };
}

type RecordedHandler = (...args: unknown[]) => void | Promise<void>;

function isRecordedHandler(value: unknown): value is RecordedHandler {
    return typeof value === "function";
}

async function emitRecordedHandler(
    handlers: ReadonlyMap<string, unknown>,
    eventName: string,
    ...args: unknown[]
): Promise<void> {
    const handler = handlers.get(eventName);
    if (!isRecordedHandler(handler)) assert.fail(`missing ${eventName} handler`);
    await handler(...args);
}

const runtimeTreeListParser = {
    parse(value: unknown): RuntimeTreeList {
        if (!isRuntimeTreeList(value)) {
            assert.fail("installed TreeSelectorComponent returned an invalid tree list");
        }
        return value;
    },
};
function clearPatchState(): void {
    Reflect.deleteProperty(globalThis, PATCH_KEY);
}

function getPatchState(): boolean | undefined {
    if (Object.getOwnPropertyDescriptor(globalThis, PATCH_KEY)?.value === true) return true;
    return undefined;
}

test("tree selector patch leaves the original selector method intact when the tree seam is invalid", async () => {
    clearPatchState();
    const originalGetTreeList = Object.getOwnPropertyDescriptor(
        InvalidTreeSelectorComponent.prototype,
        "getTreeList",
    );
    let headerPatchCount = 0;

    try {
        await patchTreeSelector({
            async loadTreeInternals() {
                const [, themeModule] = fakeTreeInternals([]);
                return [{ TreeSelectorComponent: InvalidTreeSelectorComponent }, themeModule];
            },
            patchTreeHeaderText() {
                headerPatchCount += 1;
            },
        });

        const currentGetTreeList = Object.getOwnPropertyDescriptor(
            InvalidTreeSelectorComponent.prototype,
            "getTreeList",
        );
        assert.deepEqual(currentGetTreeList, originalGetTreeList);
        assert.equal(headerPatchCount, 0);
        assert.equal(getPatchState(), undefined);
    } finally {
        clearPatchState();
    }
});

test("tree selector patch degrades safely when getTreeList returns null", async () => {
    clearPatchState();
    const originalGetTreeList = Object.getOwnPropertyDescriptor(
        NullTreeSelectorComponent.prototype,
        "getTreeList",
    );

    try {
        await patchTreeSelector({
            async loadTreeInternals() {
                const [, themeModule] = fakeTreeInternals([]);
                return [{ TreeSelectorComponent: NullTreeSelectorComponent }, themeModule];
            },
            patchTreeHeaderText() {
                assert.fail("header must not be patched without a valid tree list");
            },
        });

        assert.deepEqual(
            Object.getOwnPropertyDescriptor(NullTreeSelectorComponent.prototype, "getTreeList"),
            originalGetTreeList,
        );
        assert.equal(getPatchState(), undefined);
    } finally {
        clearPatchState();
    }
});

test("tree selector patch updates shared settings state after reinstall", async () => {
    clearPatchState();
    const themeNames: Array<string | undefined> = [];

    try {
        await patchTreeSelector({
            async loadTreeInternals() {
                return fakeTreeInternals(themeNames);
            },
            patchTreeHeaderText() {},
            settings: {
                getConfiguredThemeName() {
                    return "old-theme";
                },
                getPersistedMode() {
                    return "off";
                },
                getPersistedPreviewEnabled() {
                    return false;
                },
                getPersistedMaxVisibleLines() {
                    return 7;
                },
                getPersistedPreviewFullHeight() {
                    return true;
                },
                persistMode() {},
                persistPreviewEnabled() {},
            },
        });

        const firstSelector = new FakeTreeSelectorComponent();
        assert.equal(firstSelector.getTreeList().maxVisibleLines, 7);

        await patchTreeSelector({
            async loadTreeInternals() {
                return fakeTreeInternals(themeNames);
            },
            patchTreeHeaderText() {},
            settings: {
                getConfiguredThemeName() {
                    return "new-theme";
                },
                getPersistedMode() {
                    return "absolute";
                },
                getPersistedPreviewEnabled() {
                    return true;
                },
                getPersistedMaxVisibleLines() {
                    return 11;
                },
                getPersistedPreviewFullHeight() {
                    return false;
                },
                persistMode() {},
                persistPreviewEnabled() {},
            },
        });

        const secondSelector = new FakeTreeSelectorComponent();
        assert.equal(secondSelector.getTreeList().maxVisibleLines, 11);
        assert.deepEqual(themeNames, ["old-theme", "new-theme"]);
    } finally {
        clearPatchState();
    }
});

test("tree selector patch composes input, status, timestamps, preview, and narrow fallback", async () => {
    clearPatchState();
    const persistedModes: string[] = [];
    const persistedPreviewValues: boolean[] = [];
    const node: TreeNode = {
        entry: {
            id: "assistant-entry",
            timestamp: "2024-01-02T03:04:00.000Z",
            type: "message",
            message: {
                role: "assistant",
                content: [{ type: "text", text: "Selected response preview" }],
            },
        },
    };

    try {
        await patchTreeSelector({
            async loadTreeInternals() {
                return fakeTreeInternals([]);
            },
            patchTreeHeaderText() {},
            settings: {
                getConfiguredThemeName() {
                    return undefined;
                },
                getPersistedMode() {
                    return "relative";
                },
                getPersistedPreviewEnabled() {
                    return true;
                },
                getPersistedMaxVisibleLines() {
                    return 3;
                },
                getPersistedPreviewFullHeight() {
                    return false;
                },
                persistMode(mode) {
                    persistedModes.push(mode);
                },
                persistPreviewEnabled(enabled) {
                    persistedPreviewValues.push(enabled);
                },
            },
        });

        const tree = new FakeTreeSelectorComponent().getTreeList();
        tree.filteredNodes = [
            {
                node,
                indent: 0,
                showConnector: false,
                isLast: true,
                gutters: [],
                isVirtualRootChild: false,
            },
        ];

        assert.equal(tree.maxVisibleLines, 3);
        assert.match(tree.getEntryDisplayText(node, false), / ago entry$/);
        assert.equal(tree.getStatusLabels(), "  Filter: Default | Time: Relative | Preview: On");
        tree.handleInput(FILTER_ALL_KEY);
        assert.deepEqual(tree.handledInputs, [FILTER_ALL_KEY]);
        assert.equal(tree.getStatusLabels(), "  Filter: Default | Time: Relative | Preview: On");
        assert.match(tree.render(100).join("\n"), /entry.* │ Selected response preview/);
        assert.deepEqual(tree.render(40), ["native:40"]);

        setKeybindings(
            new KeybindingsManager({
                "app.tree.toggleLabelTimestamp": {
                    defaultKeys: "shift+t",
                    description: "Toggle tree label timestamps",
                },
            }),
        );
        tree.handleInput("T");
        assert.deepEqual(persistedModes, ["absolute"]);
        assert.match(tree.getStatusLabels(), /Time: Absolute/);

        tree.handleInput("P");
        assert.deepEqual(persistedPreviewValues, [false]);
        assert.match(tree.getStatusLabels(), /Preview: Off/);
        assert.deepEqual(tree.render(100), ["native:100"]);

        tree.handleInput("x");
        assert.deepEqual(tree.handledInputs, [FILTER_ALL_KEY, "x"]);
    } finally {
        clearPatchState();
    }
});

test("registered session lifecycle patches and exercises the installed Pi tree selector", async ({
    onTestFinished,
}) => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-tree-runtime-"));
    const configPath = path.join(agentDir, "extension-settings", "pi-tree.json");
    const node: TreeNode & { children: Array<TreeNode & { children: unknown[] }> } = {
        entry: {
            id: "assistant-entry",
            timestamp: "2024-01-02T03:04:00.000Z",
            type: "message",
            message: {
                role: "assistant",
                content: [{ type: "text", text: "Selected response preview" }],
            },
        },
        children: [],
    };
    const restoreTheme = await initializePiTheme();
    onTestFinished(restoreTheme);
    const internals = await loadTreeInternals();
    if (internals === undefined) {
        assert.fail("installed Pi tree internals must be loadable");
    }
    const [{ TreeSelectorComponent }] = internals;
    const selectorBeforePatch = new TreeSelectorComponent(
        [node],
        node.entry.id,
        24,
        () => undefined,
        () => undefined,
        () => undefined,
        undefined,
        undefined,
    );
    const selectorPrototypeValue: unknown = Object.getPrototypeOf(selectorBeforePatch);
    if (!isRuntimeTreeSelectorPrototype(selectorPrototypeValue)) {
        assert.fail("installed TreeSelectorComponent prototype is missing getTreeList");
    }
    const selectorPrototype = selectorPrototypeValue;
    const originalGetTreeListDescriptor = Object.getOwnPropertyDescriptor(
        selectorPrototype,
        "getTreeList",
    );
    if (originalGetTreeListDescriptor === undefined) {
        assert.fail("installed TreeSelectorComponent prototype is missing own getTreeList");
    }
    if (!isRuntimeGetTreeList(originalGetTreeListDescriptor.value)) {
        assert.fail("installed TreeSelectorComponent getTreeList is not callable");
    }
    const originalGetTreeList = originalGetTreeListDescriptor.value;
    const treeBeforePatch = runtimeTreeListParser.parse(
        originalGetTreeList.call(selectorBeforePatch),
    );
    const treeListPrototypeValue: unknown = Object.getPrototypeOf(treeBeforePatch);
    if (!isRuntimeTreeList(treeListPrototypeValue)) {
        assert.fail("installed tree list is missing a valid prototype");
    }
    const treeListPrototype = treeListPrototypeValue;
    const patchedMethodNames = [
        "getEntryDisplayText",
        "getStatusLabels",
        "handleInput",
        "render",
    ] as const;
    const originalTreeListDescriptors = new Map<PropertyKey, PropertyDescriptor>();
    for (const methodName of patchedMethodNames) {
        const descriptor = Object.getOwnPropertyDescriptor(treeListPrototype, methodName);
        if (descriptor === undefined) {
            assert.fail(`installed tree list is missing ${methodName}`);
        }
        originalTreeListDescriptors.set(methodName, descriptor);
    }
    const originalRenderDescriptor = Object.getOwnPropertyDescriptor(treeListPrototype, "render");
    if (
        originalRenderDescriptor === undefined ||
        !isRuntimeRender(originalRenderDescriptor.value)
    ) {
        assert.fail("installed tree list prototype is missing render");
    }
    const originalRender = originalRenderDescriptor.value;
    const lifecycle = createRecordedExtensionLifecycle();

    clearPatchState();
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
        configPath,
        JSON.stringify({
            treeTimestampMode: "relative",
            treeSelectedPreview: true,
            treeMaxVisibleLines: 5,
            treePreviewFullHeight: false,
        }),
        "utf8",
    );

    try {
        treeTimestampsExtension(lifecycle.api);
        assert.deepEqual([...lifecycle.handlers.keys()], ["session_start", "session_shutdown"]);

        await emitRecordedHandler(
            lifecycle.handlers,
            "session_start",
            { reason: "startup" },
            {
                cwd: agentDir,
                isProjectTrusted() {
                    return false;
                },
            },
        );

        assert.equal(getPatchState(), true);
        assert.notDeepEqual(
            Object.getOwnPropertyDescriptor(selectorPrototype, "getTreeList"),
            originalGetTreeListDescriptor,
        );
        for (const methodName of patchedMethodNames) {
            assert.notDeepEqual(
                Object.getOwnPropertyDescriptor(treeListPrototype, methodName),
                originalTreeListDescriptors.get(methodName),
                `session_start did not patch installed ${methodName}`,
            );
        }

        const selector = new TreeSelectorComponent(
            [node],
            node.entry.id,
            24,
            () => undefined,
            () => undefined,
            () => undefined,
            undefined,
            undefined,
        );
        const tree = runtimeTreeListParser.parse(selectorPrototype.getTreeList.call(selector));

        assert.equal(tree.maxVisibleLines, 5);
        assert.equal(tree.getStatusLabels(), "  Filter: Default | Time: Relative | Preview: On");
        const timestampedEntry = tree.getEntryDisplayText(node, false);
        assert.match(timestampedEntry, / ago /);
        assert.match(timestampedEntry, /assistant: .*Selected response preview/);

        tree.handleInput(FILTER_ALL_KEY);
        assert.equal(tree.getStatusLabels(), "  Filter: Default | Time: Relative | Preview: On");

        const wideRender = tree.render(100);
        assert.match(wideRender.join("\n"), / │ .*Selected response preview/);
        const nativeNarrowRender = originalRender.call(tree, 40);
        assert.deepEqual(tree.render(40), nativeNarrowRender);

        setKeybindings(
            new KeybindingsManager({
                "app.tree.toggleLabelTimestamp": {
                    defaultKeys: "shift+t",
                    description: "Toggle tree label timestamps",
                },
            }),
        );
        tree.handleInput("T");
        assert.match(tree.getStatusLabels(), /Time: Absolute/);
        tree.handleInput("P");
        assert.match(tree.getStatusLabels(), /Preview: Off/);
        const nativeWideRender = originalRender.call(tree, 100);
        assert.deepEqual(tree.render(100), nativeWideRender);
    } finally {
        for (const [methodName, descriptor] of originalTreeListDescriptors) {
            Object.defineProperty(treeListPrototype, methodName, descriptor);
        }
        Object.defineProperty(selectorPrototype, "getTreeList", originalGetTreeListDescriptor);
        clearPatchState();
        try {
            const shutdownHandler = lifecycle.handlers.get("session_shutdown");
            if (isRecordedHandler(shutdownHandler)) {
                await shutdownHandler();
            }
        } finally {
            await rm(agentDir, { recursive: true, force: true });
            if (originalAgentDir === undefined) {
                delete process.env.PI_CODING_AGENT_DIR;
            } else {
                process.env.PI_CODING_AGENT_DIR = originalAgentDir;
            }
        }
    }
});
