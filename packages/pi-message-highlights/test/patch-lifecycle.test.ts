import assert from "node:assert/strict";
import { test } from "vitest";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    Editor,
    Markdown,
    stripTerminalSequences,
    TuiMainScreen,
    type EditorTheme,
    type MarkdownTheme,
    type Terminal,
} from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import messageHighlightsExtension from "../src/index.ts";
import plainUserMessagesExtension from "../../pi-plain-user-messages/src/index.ts";
import responseRendererExtension from "../../pi-response-renderer/src/index.ts";

type RenderPrototype = {
    render(width: number): string[];
};

type AssistantPrototype = RenderPrototype & {
    updateContent(message: unknown): void;
};

type MessageComponent = {
    render(width: number): string[];
};

type AssistantComponentConstructor = new (
    message: AssistantMessage,
    hideThinkingBlock: boolean,
    theme: MarkdownTheme,
    hiddenThinkingLabel: string,
    outputPad: number,
) => MessageComponent;

type UserComponentConstructor = new (
    text: string,
    theme: MarkdownTheme,
    outputPad: number,
) => MessageComponent;

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
        join(dirname(codingAgentEntry), "modes/interactive/theme/theme.js"),
    ).href;
    // Pi's theme module is an internal runtime file with no public package export.
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
const identity = (text: string): string => text;
const markdownTheme = {
    heading: identity,
    link: identity,
    linkUrl: identity,
    code: identity,
    codeBlock: identity,
    codeBlockBorder: identity,
    quote: identity,
    quoteBorder: identity,
    hr: identity,
    listBullet: identity,
    bold: identity,
    italic: identity,
    strikethrough: identity,
    underline: identity,
} satisfies MarkdownTheme;

const editorTheme = {
    borderColor: identity,
    selectList: {
        selectedPrefix: identity,
        selectedText: identity,
        description: identity,
        scrollInfo: identity,
        noMatch: identity,
    },
} satisfies EditorTheme;

class FakeTerminal implements Terminal {
    columns = 80;
    rows = 24;

    get kittyProtocolActive(): boolean {
        return false;
    }

    start(): void {}
    stop(): void {}
    async drainInput(): Promise<void> {}
    write(_data: string): void {}
    moveBy(): void {}
    hideCursor(): void {}
    showCursor(): void {}
    clearLine(): void {}
    clearFromCursor(): void {}
    clearScreen(): void {}
    setTitle(): void {}
    setProgress(): void {}
}

const ESC = String.fromCharCode(0x1b);

async function loadComponentExport(fileName: string, exportName: string): Promise<unknown> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const componentUrl = pathToFileURL(
        join(dirname(codingAgentEntry), "modes/interactive/components", fileName),
    ).href;
    // Pi's internal component files are resolved from the installed package at runtime.
    const componentModule: unknown = (await import(componentUrl)) as unknown;
    if (
        (typeof componentModule !== "object" || componentModule === null) &&
        typeof componentModule !== "function"
    ) {
        assert.fail(`missing ${exportName}`);
    }
    return Reflect.get(componentModule, exportName) as unknown;
}
type LifecycleApi = {
    readonly api: ExtensionAPI;
    readonly shutdownHandlers: Array<() => void>;
};

function createLifecycleApi(): LifecycleApi {
    const shutdownHandlers: Array<() => void> = [];
    const api = {
        on(event: string, handler: () => void): void {
            if (event === "session_shutdown") shutdownHandlers.push(handler);
        },
    };

    // SAFETY: These extensions use only ExtensionAPI.on during this lifecycle test.
    const untypedApi: unknown = api;
    return { api: untypedApi as ExtensionAPI, shutdownHandlers };
}

async function loadComponentPrototype<T extends RenderPrototype>(
    fileName: string,
    exportName: string,
): Promise<T> {
    const component: unknown = await loadComponentExport(fileName, exportName);
    if (typeof component !== "function") assert.fail(`missing ${exportName}`);
    const prototype: unknown = Reflect.get(component, "prototype");
    if (
        typeof prototype !== "object" ||
        prototype === null ||
        typeof Reflect.get(prototype, "render") !== "function"
    ) {
        assert.fail(`invalid ${exportName} prototype`);
    }
    // SAFETY: The runtime checks above establish the render-capable prototype contract.
    return prototype as T;
}

async function exerciseMessageRenderLifecycle(): Promise<void> {
    const assistantPrototype = await loadComponentPrototype<AssistantPrototype>(
        "assistant-message.js",
        "AssistantMessageComponent",
    );
    const userPrototype = await loadComponentPrototype<RenderPrototype>(
        "user-message.js",
        "UserMessageComponent",
    );
    const originalAssistantRender = Reflect.get(assistantPrototype, "render");
    const originalAssistantUpdateContent = Reflect.get(assistantPrototype, "updateContent");
    const originalUserRender = Reflect.get(userPrototype, "render");
    const originalEditorRender = Reflect.get(Editor.prototype, "render");
    const originalMarkdownRender = Reflect.get(Markdown.prototype, "render");
    for (let cycle = 0; cycle < 2; cycle += 1) {
        const responseLifecycle = createLifecycleApi();
        const plainLifecycle = createLifecycleApi();
        const highlightsLifecycle = createLifecycleApi();
        const shutdown = (): void => {
            for (const handler of responseLifecycle.shutdownHandlers) handler();
            for (const handler of plainLifecycle.shutdownHandlers) handler();
            for (const handler of highlightsLifecycle.shutdownHandlers) handler();
        };

        try {
            await responseRendererExtension(responseLifecycle.api);
            await plainUserMessagesExtension(plainLifecycle.api);
            await messageHighlightsExtension(highlightsLifecycle.api);

            const AssistantMessageComponent = (await loadComponentExport(
                "assistant-message.js",
                "AssistantMessageComponent",
            )) as AssistantComponentConstructor;
            const UserMessageComponent = (await loadComponentExport(
                "user-message.js",
                "UserMessageComponent",
            )) as UserComponentConstructor;
            const message = {
                role: "assistant",
                content: [{ type: "text", text: "Read https://example.com/docs now" }],
                api: "openai-responses",
                provider: "openai",
                model: "gpt-5",
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: "stop",
                timestamp: 0,
            } satisfies AssistantMessage;
            const assistant = new AssistantMessageComponent(
                message,
                false,
                markdownTheme,
                "Thinking",
                0,
            );
            const user = new UserMessageComponent(
                "Open https://example.com/account",
                markdownTheme,
                0,
            );
            const editor = new Editor(new TuiMainScreen(new FakeTerminal()), editorTheme);
            editor.setText("Visit https://example.com/settings");

            const assistantRaw = assistant.render(80).join("\n");
            const userRaw = user.render(80).join("\n");
            const editorRaw = editor.render(80).join("\n");
            const urlHighlight = new RegExp(`${ESC}\\[38;(?:2;135;215;255|5;\\d+)m`);
            assert.match(assistantRaw, urlHighlight);
            assert.match(userRaw, urlHighlight);
            assert.match(editorRaw, urlHighlight);
            assert.match(
                stripTerminalSequences(assistantRaw),
                /Read https:\/\/example\.com\/docs now/,
            );
            assert.match(stripTerminalSequences(userRaw), /Open https:\/\/example\.com\/account/);
            assert.match(
                stripTerminalSequences(editorRaw),
                /Visit https:\/\/example\.com\/settings/,
            );
            assert.notEqual(Reflect.get(assistantPrototype, "render"), originalAssistantRender);
            assert.notEqual(Reflect.get(userPrototype, "render"), originalUserRender);
        } finally {
            shutdown();
        }

        assert.equal(Reflect.get(assistantPrototype, "render"), originalAssistantRender);
        assert.equal(
            Reflect.get(assistantPrototype, "updateContent"),
            originalAssistantUpdateContent,
        );
        assert.equal(Reflect.get(userPrototype, "render"), originalUserRender);
        assert.equal(Reflect.get(Editor.prototype, "render"), originalEditorRender);
        assert.equal(Reflect.get(Markdown.prototype, "render"), originalMarkdownRender);
    }
}

test("message render wrappers restore cleanly across reload cycles", async () => {
    const restoreTheme = await initializePiTheme();
    try {
        await exerciseMessageRenderLifecycle();
    } finally {
        restoreTheme();
    }
});
