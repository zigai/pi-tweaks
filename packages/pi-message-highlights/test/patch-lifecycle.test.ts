import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, Markdown } from "@earendil-works/pi-tui";
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
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const componentUrl = pathToFileURL(
        join(dirname(codingAgentEntry), "modes/interactive/components", fileName),
    ).href;
    const componentModule: unknown = (await import(componentUrl)) as unknown;
    if (
        (typeof componentModule !== "object" || componentModule === null) &&
        typeof componentModule !== "function"
    ) {
        assert.fail(`missing ${exportName}`);
    }
    const component: unknown = Reflect.get(componentModule, exportName) as unknown;
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

test("message render wrappers restore cleanly across reload cycles", async () => {
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
});
