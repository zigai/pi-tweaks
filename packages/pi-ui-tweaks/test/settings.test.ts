import assert from "node:assert/strict";
import test from "node:test";

import { resolveUiTweaksConfig } from "../src/settings.ts";

void test("ui tweaks settings default to enabled tweaks", () => {
    const loaded = resolveUiTweaksConfig([]);

    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, true);
    assert.deepEqual(loaded.errors, []);
});

void test("ui tweaks settings merge sources in precedence order", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                uiTweaks: { hideModelProviderHint: false, hideSlashCommandSourceTags: true },
            },
        },
        {
            label: "project",
            settings: {
                uiTweaks: { hideModelProviderHint: true, hideSlashCommandSourceTags: false },
            },
        },
    ]);

    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, false);
});

void test("ui tweaks enabled false disables every tweak", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: { uiTweaks: { enabled: false, hideModelProviderHint: true } },
        },
    ]);

    assert.equal(loaded.config.hideModelProviderHint, false);
    assert.equal(loaded.config.hideSlashCommandSourceTags, false);
});

void test("ui tweaks settings report invalid custom values", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                uiTweaks: { hideModelProviderHint: "no", hideSlashCommandSourceTags: "yes" },
            },
        },
    ]);

    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, true);
    assert.deepEqual(loaded.errors, [
        "global.uiTweaks.hideModelProviderHint must be a boolean.",
        "global.uiTweaks.hideSlashCommandSourceTags must be a boolean.",
    ]);
});
