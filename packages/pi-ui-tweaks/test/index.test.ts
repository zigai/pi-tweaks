import assert from "node:assert/strict";
import { SelectList } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

import uiTweaksExtension from "../src/index.ts";

type LifecycleHandler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>;

function registerLifecycleHandlers(): Map<string, LifecycleHandler> {
    const handlers = new Map<string, LifecycleHandler>();
    const api = {
        on(event: string, handler: LifecycleHandler): void {
            handlers.set(event, handler);
        },
    };
    // SAFETY: This test exercises only the extension's lifecycle registration seam implemented above.
    uiTweaksExtension(api as unknown as ExtensionAPI);
    return handlers;
}

function headlessContext(): ExtensionContext {
    const context = {
        cwd: process.cwd(),
        hasUI: false,
        isProjectTrusted(): boolean {
            return true;
        },
        ui: {
            getEditorComponent() {
                return undefined;
            },
            notify(): void {},
            setEditorComponent(): void {},
        },
    };
    // SAFETY: Feature installers consume only the explicitly represented context members in this test.
    return context as unknown as ExtensionContext;
}

test("composition root registers session lifecycle handlers", () => {
    const handlers = registerLifecycleHandlers();
    assert.equal(typeof handlers.get("session_start"), "function");
    assert.equal(typeof handlers.get("session_shutdown"), "function");
});

test("session shutdown disposes installed patches and a later start installs once again", async () => {
    const handlers = registerLifecycleHandlers();
    const start = handlers.get("session_start");
    const shutdown = handlers.get("session_shutdown");
    assert.ok(start);
    assert.ok(shutdown);
    const context = headlessContext();
    const originalRender = Reflect.get(SelectList.prototype, "render");

    await start({}, context);
    const firstPatchedRender = Reflect.get(SelectList.prototype, "render");
    assert.notEqual(firstPatchedRender, originalRender);

    await start({}, context);
    assert.equal(Reflect.get(SelectList.prototype, "render"), firstPatchedRender);

    await shutdown({}, context);
    assert.equal(Reflect.get(SelectList.prototype, "render"), originalRender);

    await start({}, context);
    assert.notEqual(Reflect.get(SelectList.prototype, "render"), originalRender);
    await shutdown({}, context);
    assert.equal(Reflect.get(SelectList.prototype, "render"), originalRender);
});
