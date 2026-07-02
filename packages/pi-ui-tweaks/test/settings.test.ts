import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveUiTweaksConfig } from "../src/settings.ts";

test("ui tweaks settings default to enabled tweaks", () => {
    const loaded = resolveUiTweaksConfig([]);

    assert.equal(loaded.config.bashExecPromptSpacing, true);
    assert.equal(loaded.config.compactModelSelector, true);
    assert.equal(loaded.config.hideModelChangeStatus, true);
    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, true);
    assert.equal(loaded.config.neutralBorderColor, true);
    assert.deepEqual(loaded.errors, []);
});

test("ui tweaks settings merge sources in precedence order", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                uiTweaks: {
                    bashExecPromptSpacing: false,
                    compactModelSelector: false,
                    hideModelChangeStatus: false,
                    hideModelProviderHint: false,
                    hideSlashCommandSourceTags: true,
                    neutralBorderColor: false,
                },
            },
        },
        {
            label: "project",
            settings: {
                uiTweaks: {
                    bashExecPromptSpacing: true,
                    hideModelChangeStatus: true,
                    hideModelProviderHint: true,
                    hideSlashCommandSourceTags: false,
                },
            },
        },
    ]);

    assert.equal(loaded.config.bashExecPromptSpacing, true);
    assert.equal(loaded.config.compactModelSelector, false);
    assert.equal(loaded.config.hideModelChangeStatus, true);
    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, false);
    assert.equal(loaded.config.neutralBorderColor, false);
});

test("ui tweaks enabled false disables every tweak", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: { uiTweaks: { enabled: false, hideModelProviderHint: true } },
        },
    ]);

    assert.equal(loaded.config.bashExecPromptSpacing, false);
    assert.equal(loaded.config.compactModelSelector, false);
    assert.equal(loaded.config.hideModelChangeStatus, false);
    assert.equal(loaded.config.hideModelProviderHint, false);
    assert.equal(loaded.config.hideSlashCommandSourceTags, false);
    assert.equal(loaded.config.neutralBorderColor, false);
});

test("ui tweaks settings report invalid custom values", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                uiTweaks: {
                    bashExecPromptSpacing: "nah",
                    compactModelSelector: "nah",
                    hideModelChangeStatus: "nah",
                    hideModelProviderHint: "no",
                    hideSlashCommandSourceTags: "yes",
                    neutralBorderColor: "nope",
                },
            },
        },
    ]);

    assert.equal(loaded.config.bashExecPromptSpacing, true);
    assert.equal(loaded.config.compactModelSelector, true);
    assert.equal(loaded.config.hideModelChangeStatus, true);
    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, true);
    assert.equal(loaded.config.neutralBorderColor, true);
    assert.deepEqual(loaded.errors, [
        "global.uiTweaks.bashExecPromptSpacing must be a boolean.",
        "global.uiTweaks.compactModelSelector must be a boolean.",
        "global.uiTweaks.hideModelChangeStatus must be a boolean.",
        "global.uiTweaks.hideModelProviderHint must be a boolean.",
        "global.uiTweaks.hideSlashCommandSourceTags must be a boolean.",
        "global.uiTweaks.neutralBorderColor must be a boolean.",
    ]);
});
