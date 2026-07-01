import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveFooterConfig } from "../src/settings.ts";

test("resolveFooterConfig defaults to pipe separator", () => {
    const loaded = resolveFooterConfig([]);

    assert.equal(loaded.config.separator, "|");
    assert.deepEqual(loaded.errors, []);
});

test("resolveFooterConfig reads and sanitizes separator setting", () => {
    const loaded = resolveFooterConfig([
        {
            label: "global settings",
            settings: {
                footer: {
                    separator: "  ·\n",
                },
            },
        },
    ]);

    assert.equal(loaded.config.separator, "·");
    assert.deepEqual(loaded.errors, []);
});

test("resolveFooterConfig lets later sources override earlier sources", () => {
    const loaded = resolveFooterConfig([
        {
            label: "global settings",
            settings: {
                footer: {
                    separator: "|",
                },
            },
        },
        {
            label: "project settings",
            settings: {
                footer: {
                    separator: "/",
                },
            },
        },
    ]);

    assert.equal(loaded.config.separator, "/");
});

test("resolveFooterConfig reports invalid separator settings", () => {
    const loaded = resolveFooterConfig([
        {
            label: "global settings",
            settings: {
                footer: {
                    separator: "   ",
                },
            },
        },
    ]);

    assert.equal(loaded.config.separator, "|");
    assert.deepEqual(loaded.errors, [
        "global settings.footer.separator must contain a visible character.",
    ]);
});
