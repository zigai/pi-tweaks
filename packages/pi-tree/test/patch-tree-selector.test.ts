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

const PI_THEME_KEYS = [
    Symbol.for("@earendil-works/pi-coding-agent:theme"),
    Symbol.for("@mariozechner/pi-coding-agent:theme"),
] as const;

function restoreThemeSnapshot(themeModule: object, snapshots: readonly ThemeSnapshot[]): void {
    const stopThemeWatcher: unknown = Reflect.get(themeModule, "stopThemeWatcher");
    if (typeof stopThemeWatcher === "function") {
        Reflect.apply(stopThemeWatcher, themeModule, []);
    }

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
    // Pi's theme implementation is an unexported runtime module selected from the resolved package.
    const themeModule: unknown = (await import(themeUrl)) as unknown;
    if (
        (typeof themeModule !== "object" || themeModule === null) &&
        typeof themeModule !== "function"
    ) {
        assert.fail("missing theme module");
    }

    const initTheme: unknown = Reflect.get(themeModule, "initTheme");
    if (typeof initTheme !== "function") {
        assert.fail("missing initTheme");
    }

    const snapshots: ThemeSnapshot[] = PI_THEME_KEYS.map((key) => ({
        key,
        descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
    }));
    try {
        Reflect.apply(initTheme, themeModule, [undefined, false]);
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

    getTreeList(): unknown {
        return this.list;
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

type RuntimeTreeList = TreeListInstance & {
    getEntryDisplayText(node: TreeNode, isSelected: boolean): string;
    getStatusLabels(): string;
    handleInput(keyData: string): void;
    render(width: number): string[];
};

type RuntimeTreeSelectorInstance = InstanceType<TreeSelectorModule["TreeSelectorComponent"]>;

type RuntimeGetTreeList = (this: RuntimeTreeSelectorInstance) => unknown;

function isRuntimeGetTreeList(value: unknown): value is RuntimeGetTreeList {
    return typeof value === "function";
}

type RuntimeTreeSelectorPrototype = {
    readonly getTreeList: RuntimeGetTreeList;
};

function isRuntimeTreeSelectorPrototype(value: unknown): value is RuntimeTreeSelectorPrototype {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const getTreeList: unknown = Reflect.get(value, "getTreeList");
    return isRuntimeGetTreeList(getTreeList);
}

function requireObject(value: unknown, message: string): object {
    if (typeof value !== "object" || value === null) {
        assert.fail(message);
    }
    return value;
}

function isRuntimeTreeList(value: unknown): value is RuntimeTreeList {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return false;
    }
    return (
        typeof Reflect.get(value, "getEntryDisplayText") === "function" &&
        typeof Reflect.get(value, "getStatusLabels") === "function" &&
        typeof Reflect.get(value, "handleInput") === "function" &&
        typeof Reflect.get(value, "render") === "function"
    );
}

type RecordedExtensionLifecycle = {
    readonly api: ExtensionAPI;
    readonly handlers: Map<string, unknown>;
};

function createRecordedExtensionLifecycle(): RecordedExtensionLifecycle {
    const handlers = new Map<string, unknown>();
    const api = {
        on(event: string, handler: unknown): void {
            handlers.set(event, handler);
        },
    };

    // SAFETY: The recording boundary implements the ExtensionAPI.on shape used by this
    // extension and retains the exact handlers Pi would invoke at runtime.
    const extensionApi: unknown = api;
    return { api: extensionApi as ExtensionAPI, handlers };
}

async function emitRecordedHandler(
    handlers: ReadonlyMap<string, unknown>,
    eventName: string,
    ...args: unknown[]
): Promise<void> {
    const handler = handlers.get(eventName);
    if (typeof handler !== "function") {
        assert.fail(`missing ${eventName} handler`);
    }
    await Reflect.apply(handler, undefined, args);
}

function requireRuntimeTreeList(value: unknown): RuntimeTreeList {
    if (!isRuntimeTreeList(value)) {
        assert.fail("installed TreeSelectorComponent returned an invalid tree list");
    }
    return value;
}

test("tree selector patch leaves the original selector method intact when the tree seam is invalid", async () => {
    const globalState = globalThis as typeof globalThis & { [PATCH_KEY]?: boolean };
    delete globalState[PATCH_KEY];
    const originalGetTreeList: unknown = Object.getOwnPropertyDescriptor(
        InvalidTreeSelectorComponent.prototype,
        "getTreeList",
    )?.value;
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

        const currentGetTreeList: unknown = Object.getOwnPropertyDescriptor(
            InvalidTreeSelectorComponent.prototype,
            "getTreeList",
        )?.value;
        assert.equal(currentGetTreeList, originalGetTreeList);
        assert.equal(headerPatchCount, 0);
        assert.equal(globalState[PATCH_KEY], undefined);
    } finally {
        delete globalState[PATCH_KEY];
    }
});

test("tree selector patch updates shared settings state after reinstall", async () => {
    const globalState = globalThis as typeof globalThis & { [PATCH_KEY]?: boolean };
    delete globalState[PATCH_KEY];
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
        delete globalState[PATCH_KEY];
    }
});

test("tree selector patch composes input, status, timestamps, preview, and narrow fallback", async () => {
    const globalState = globalThis as typeof globalThis & { [PATCH_KEY]?: boolean };
    delete globalState[PATCH_KEY];
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
        delete globalState[PATCH_KEY];
    }
});

test("registered session lifecycle patches and exercises the installed Pi tree selector", async ({
    onTestFinished,
}) => {
    const globalState = globalThis as typeof globalThis & { [PATCH_KEY]?: boolean };
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
    const originalGetTreeListValue: unknown = originalGetTreeListDescriptor.value;
    if (!isRuntimeGetTreeList(originalGetTreeListValue)) {
        assert.fail("installed TreeSelectorComponent getTreeList is not callable");
    }
    const originalGetTreeList = originalGetTreeListValue;
    const treeBeforePatch = requireRuntimeTreeList(originalGetTreeList.call(selectorBeforePatch));
    const treeListPrototypeValue: unknown = Object.getPrototypeOf(treeBeforePatch);
    const treeListPrototype = requireObject(
        treeListPrototypeValue,
        "installed tree list is missing a prototype",
    );
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
    const originalRender: unknown = Reflect.get(treeListPrototype, "render");
    if (typeof originalRender !== "function") {
        assert.fail("installed tree list prototype is missing render");
    }
    const lifecycle = createRecordedExtensionLifecycle();

    delete globalState[PATCH_KEY];
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

        assert.equal(globalState[PATCH_KEY], true);
        assert.notEqual(Reflect.get(selectorPrototype, "getTreeList"), originalGetTreeList);
        for (const methodName of patchedMethodNames) {
            assert.notEqual(
                Reflect.get(treeListPrototype, methodName),
                originalTreeListDescriptors.get(methodName)?.value,
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
        const getTreeListValue: unknown = Reflect.get(selectorPrototype, "getTreeList");
        if (!isRuntimeGetTreeList(getTreeListValue)) {
            assert.fail("patched TreeSelectorComponent prototype is missing getTreeList");
        }
        const tree = requireRuntimeTreeList(getTreeListValue.call(selector));

        assert.equal(Reflect.get(tree, "maxVisibleLines"), 5);
        assert.equal(tree.getStatusLabels(), "  Filter: Default | Time: Relative | Preview: On");
        const timestampedEntry = tree.getEntryDisplayText(node, false);
        assert.match(timestampedEntry, / ago /);
        assert.match(timestampedEntry, /assistant: .*Selected response preview/);

        tree.handleInput(FILTER_ALL_KEY);
        assert.equal(tree.getStatusLabels(), "  Filter: Default | Time: Relative | Preview: On");

        const wideRender = tree.render(100);
        assert.match(wideRender.join("\n"), / │ .*Selected response preview/);
        const nativeNarrowRender = Reflect.apply(originalRender, tree, [40]) as string[];
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
        const nativeWideRender = Reflect.apply(originalRender, tree, [100]) as string[];
        assert.deepEqual(tree.render(100), nativeWideRender);
    } finally {
        for (const [methodName, descriptor] of originalTreeListDescriptors) {
            Object.defineProperty(treeListPrototype, methodName, descriptor);
        }
        Object.defineProperty(selectorPrototype, "getTreeList", originalGetTreeListDescriptor);
        delete globalState[PATCH_KEY];
        try {
            const shutdownHandler = lifecycle.handlers.get("session_shutdown");
            if (typeof shutdownHandler === "function") {
                await Reflect.apply(shutdownHandler, undefined, []);
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
