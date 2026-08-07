import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

import plainUserMessagesExtension from "../src/index.ts";

type UserMessageInstance = {
    render(width: number): string[];
};

type UserMessageConstructor = new (text: string) => UserMessageInstance;

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

    // SAFETY: This behavior test exercises only ExtensionAPI.on used by the extension.
    const untypedApi: unknown = api;
    return { api: untypedApi as ExtensionAPI, shutdownHandlers };
}

async function loadUserMessageConstructor(): Promise<UserMessageConstructor> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const themePath = pathToFileURL(
        join(dirname(codingAgentEntry), "modes/interactive/theme/theme.js"),
    ).href;
    const themeModule: unknown = (await import(themePath)) as unknown;
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
    Reflect.apply(initTheme, themeModule, [undefined, false]);

    const userMessagePath = pathToFileURL(
        join(dirname(codingAgentEntry), "modes/interactive/components/user-message.js"),
    ).href;
    const userMessageModule: unknown = (await import(userMessagePath)) as unknown;
    if (
        (typeof userMessageModule !== "object" || userMessageModule === null) &&
        typeof userMessageModule !== "function"
    ) {
        assert.fail("missing user message module");
    }

    const constructor: unknown = Reflect.get(userMessageModule, "UserMessageComponent");
    if (typeof constructor !== "function") {
        assert.fail("missing UserMessageComponent");
    }

    // SAFETY: The runtime check verifies the loaded export is constructable by the
    // user-message component seam used by Pi.
    return constructor as UserMessageConstructor;
}

test("renders Markdown heading syntax literally in user messages", async () => {
    const UserMessageComponent = await loadUserMessageConstructor();
    const lifecycle = createLifecycleApi();

    try {
        await plainUserMessagesExtension(lifecycle.api);
        const message = new UserMessageComponent("# test 1");

        assert.ok(message.render(80).some((line) => line.includes("# test 1")));
    } finally {
        for (const handler of lifecycle.shutdownHandlers) handler();
    }
});
