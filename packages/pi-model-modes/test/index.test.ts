import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { test } from "vitest";

import { registerModeSelectorShortcuts } from "../src/index.ts";

type ShortcutOptions = Parameters<ExtensionAPI["registerShortcut"]>[1];

test("Ctrl+K opens the mode selector instead of cycling modes", () => {
    const shortcuts = new Map<string, ShortcutOptions>();
    const registrar: Pick<ExtensionAPI, "registerShortcut"> = {
        registerShortcut(shortcut, options): void {
            shortcuts.set(shortcut, options);
        },
    };
    const selectMode: ShortcutOptions["handler"] = () => {};

    registerModeSelectorShortcuts(registrar, selectMode);

    assert.equal(shortcuts.get("ctrl+k")?.description, "Select prompt mode");
    assert.equal(shortcuts.get("ctrl+k")?.handler, selectMode);
    assert.equal(shortcuts.get("ctrl+shift+m")?.handler, selectMode);
});
