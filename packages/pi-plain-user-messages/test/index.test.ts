import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

import plainUserMessagesExtension from "../src/index.ts";

type UserMessageInstance = {
    render(width: number): string[];
};

type UserMessageConstructor = {
    new (text: string): UserMessageInstance;
    readonly prototype: { readonly render?: UserMessageInstance["render"] };
};

type ThemeRuntimeModule = {
    readonly initTheme: (settings: undefined, watch: boolean) => void;
};

type ThemeRuntimeModuleView = {
    readonly initTheme?: ThemeRuntimeModule["initTheme"];
};

type UserMessageModuleView = {
    readonly UserMessageComponent?: UserMessageConstructor;
};
type ParsedUserMessageModule = {
    readonly UserMessageComponent: UserMessageConstructor;
};

function isThemeRuntimeModule(value: unknown): value is ThemeRuntimeModule {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
        return false;
    }
    // SAFETY: The namespace-object check permits reading initTheme, whose callable
    // contract is verified before this predicate returns true.
    return typeof (value as ThemeRuntimeModuleView).initTheme === "function";
}

function isUserMessageModule(value: unknown): value is ParsedUserMessageModule {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
        return false;
    }
    // SAFETY: The namespace-object check permits reading the dynamic component export;
    // its constructor and render prototype contracts are both verified below.
    const component = (value as UserMessageModuleView).UserMessageComponent;
    const prototype = component?.prototype;
    return typeof component === "function" && typeof prototype?.render === "function";
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

    // SAFETY: The extension reads only the on method implemented by this test seam.
    return { api: api as ExtensionAPI, shutdownHandlers };
}

async function loadUserMessageConstructor(): Promise<UserMessageConstructor> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const themePath = pathToFileURL(
        join(dirname(codingAgentEntry), "modes/interactive/theme/theme.js"),
    ).href;
    const themeModule: unknown = await import(themePath);
    if (!isThemeRuntimeModule(themeModule)) {
        assert.fail("missing theme module");
    }
    themeModule.initTheme.call(themeModule, undefined, false);

    const userMessagePath = pathToFileURL(
        join(dirname(codingAgentEntry), "modes/interactive/components/user-message.js"),
    ).href;
    const userMessageModule: unknown = await import(userMessagePath);
    if (!isUserMessageModule(userMessageModule)) {
        assert.fail("missing UserMessageComponent");
    }
    return userMessageModule.UserMessageComponent;
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
