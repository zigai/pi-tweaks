import assert from "node:assert/strict";
import { test } from "vitest";

import { isShortcutId } from "../src/shortcut-id.ts";

test("accepts plus as a shortcut base key", () => {
    assert.equal(isShortcutId("+"), true);
    assert.equal(isShortcutId("ctrl++"), true);
    assert.equal(isShortcutId("ctrl+shift++"), true);
});

test("rejects malformed plus shortcuts", () => {
    assert.equal(isShortcutId("++"), false);
    assert.equal(isShortcutId("ctrl+++"), false);
    assert.equal(isShortcutId("ctrl+ctrl++"), false);
});
