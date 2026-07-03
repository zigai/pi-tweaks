import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { loadUiTweaksConfig, resolveUiTweaksConfig } from "../src/settings.ts";

test("loadUiTweaksConfig scaffolds missing global config and schema", async () => {
    const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(path.join(tmpdir(), "pi-ui-tweaks-agent-"));
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-ui-tweaks-cwd-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    try {
        const configPath = path.join(agentDir, "pi-ui-tweaks", "config.json");
        const schemaPath = path.join(agentDir, "pi-ui-tweaks", "config.schema.json");
        const loaded = loadUiTweaksConfig(cwd, false);

        assert.deepEqual(loaded.errors, []);
        assert.equal(loaded.config.autocompleteAboveInput, true);
        assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
            $schema: "./config.schema.json",
            enabled: true,
            autocompleteAboveInput: true,
            bashExecPromptSpacing: true,
            anchorInputToBottom: false,
            compactModelSelector: true,
            hideAutocompleteScrollInfo: true,
            hideModelChangeStatus: true,
            hideModelProviderHint: true,
            hideSlashCommandSourceTags: true,
            highlightSelectedModelProvider: true,
            inputPromptPrefix: "> ",
            neutralBorderColor: true,
            restoreContentAfterAutocompleteClose: true,
            selectedOptionPrefix: "→ ",
        });
        assert.match(await readFile(schemaPath, "utf8"), /Pi UI tweaks config/);

        const customConfig = JSON.stringify({ enabled: false, selectedOptionPrefix: ">> " });
        await writeFile(configPath, customConfig, "utf8");
        await writeFile(schemaPath, "stale schema", "utf8");
        const loadedAgain = loadUiTweaksConfig(cwd, false);

        assert.equal(loadedAgain.config.autocompleteAboveInput, false);
        assert.equal(await readFile(configPath, "utf8"), customConfig);
        assert.match(await readFile(schemaPath, "utf8"), /Pi UI tweaks config/);
    } finally {
        await rm(agentDir, { recursive: true, force: true });
        await rm(cwd, { recursive: true, force: true });
        if (originalAgentDir === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalAgentDir;
        }
    }
});

test("ui tweaks settings default to enabled tweaks", () => {
    const loaded = resolveUiTweaksConfig([]);

    assert.equal(loaded.config.autocompleteAboveInput, true);
    assert.equal(loaded.config.anchorInputToBottom, false);
    assert.equal(loaded.config.bashExecPromptSpacing, true);
    assert.equal(loaded.config.compactModelSelector, true);
    assert.equal(loaded.config.hideAutocompleteScrollInfo, true);
    assert.equal(loaded.config.hideModelChangeStatus, true);
    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, true);
    assert.equal(loaded.config.highlightSelectedModelProvider, true);
    assert.equal(loaded.config.inputPromptPrefix, "> ");
    assert.equal(loaded.config.neutralBorderColor, true);
    assert.equal(loaded.config.restoreContentAfterAutocompleteClose, true);
    assert.equal(loaded.config.selectedOptionPrefix, "→ ");
    assert.deepEqual(loaded.errors, []);
});

test("ui tweaks settings merge sources in precedence order", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                autocompleteAboveInput: false,
                anchorInputToBottom: true,
                bashExecPromptSpacing: false,
                compactModelSelector: false,
                hideAutocompleteScrollInfo: false,
                hideModelChangeStatus: false,
                hideModelProviderHint: false,
                hideSlashCommandSourceTags: true,
                highlightSelectedModelProvider: false,
                inputPromptPrefix: "> ",
                neutralBorderColor: false,
                restoreContentAfterAutocompleteClose: false,
                selectedOptionPrefix: "❯ ",
            },
        },
        {
            label: "project",
            settings: {
                autocompleteAboveInput: true,
                anchorInputToBottom: false,
                bashExecPromptSpacing: true,
                hideAutocompleteScrollInfo: true,
                hideModelChangeStatus: true,
                hideModelProviderHint: true,
                hideSlashCommandSourceTags: false,
                highlightSelectedModelProvider: true,
                inputPromptPrefix: "❯",
                restoreContentAfterAutocompleteClose: true,
                selectedOptionPrefix: "▌",
            },
        },
    ]);

    assert.equal(loaded.config.autocompleteAboveInput, true);
    assert.equal(loaded.config.anchorInputToBottom, false);
    assert.equal(loaded.config.bashExecPromptSpacing, true);
    assert.equal(loaded.config.compactModelSelector, false);
    assert.equal(loaded.config.hideAutocompleteScrollInfo, true);
    assert.equal(loaded.config.hideModelChangeStatus, true);
    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, false);
    assert.equal(loaded.config.highlightSelectedModelProvider, true);
    assert.equal(loaded.config.inputPromptPrefix, "❯");
    assert.equal(loaded.config.neutralBorderColor, false);
    assert.equal(loaded.config.restoreContentAfterAutocompleteClose, true);
    assert.equal(loaded.config.selectedOptionPrefix, "▌");
});

test("ui tweaks enabled false disables every tweak", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                enabled: false,
                hideModelProviderHint: true,
                inputPromptPrefix: "❯",
                selectedOptionPrefix: "▌",
            },
        },
    ]);

    assert.equal(loaded.config.autocompleteAboveInput, false);
    assert.equal(loaded.config.anchorInputToBottom, false);
    assert.equal(loaded.config.bashExecPromptSpacing, false);
    assert.equal(loaded.config.compactModelSelector, false);
    assert.equal(loaded.config.hideAutocompleteScrollInfo, false);
    assert.equal(loaded.config.hideModelChangeStatus, false);
    assert.equal(loaded.config.hideModelProviderHint, false);
    assert.equal(loaded.config.hideSlashCommandSourceTags, false);
    assert.equal(loaded.config.highlightSelectedModelProvider, false);
    assert.equal(loaded.config.inputPromptPrefix, "> ");
    assert.equal(loaded.config.neutralBorderColor, false);
    assert.equal(loaded.config.restoreContentAfterAutocompleteClose, false);
    assert.equal(loaded.config.selectedOptionPrefix, "→ ");
});

test("ui tweaks settings report invalid custom values", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                autocompleteAboveInput: "nah",
                anchorInputToBottom: "nah",
                bashExecPromptSpacing: "nah",
                compactModelSelector: "nah",
                hideAutocompleteScrollInfo: "nah",
                hideModelChangeStatus: "nah",
                hideModelProviderHint: "no",
                hideSlashCommandSourceTags: "yes",
                highlightSelectedModelProvider: "nah",
                inputPromptPrefix: "",
                neutralBorderColor: "nope",
                restoreContentAfterAutocompleteClose: "nah",
                selectedOptionPrefix: "",
            },
        },
    ]);

    assert.equal(loaded.config.autocompleteAboveInput, true);
    assert.equal(loaded.config.anchorInputToBottom, false);
    assert.equal(loaded.config.bashExecPromptSpacing, true);
    assert.equal(loaded.config.compactModelSelector, true);
    assert.equal(loaded.config.hideAutocompleteScrollInfo, true);
    assert.equal(loaded.config.hideModelChangeStatus, true);
    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.config.hideSlashCommandSourceTags, true);
    assert.equal(loaded.config.highlightSelectedModelProvider, true);
    assert.equal(loaded.config.inputPromptPrefix, "> ");
    assert.equal(loaded.config.neutralBorderColor, true);
    assert.equal(loaded.config.restoreContentAfterAutocompleteClose, true);
    assert.equal(loaded.config.selectedOptionPrefix, "→ ");
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0] ?? "", /global is invalid:/);
    assert.match(loaded.errors[0] ?? "", /autocompleteAboveInput/);
    assert.match(loaded.errors[0] ?? "", /anchorInputToBottom/);
    assert.match(loaded.errors[0] ?? "", /bashExecPromptSpacing/);
    assert.match(loaded.errors[0] ?? "", /hideAutocompleteScrollInfo/);
});

test("ui tweaks settings reject unknown config keys", () => {
    const loaded = resolveUiTweaksConfig([
        {
            label: "global",
            settings: {
                hideModelProviderHnit: false,
            },
        },
    ]);

    assert.equal(loaded.config.hideModelProviderHint, true);
    assert.equal(loaded.errors.length, 1);
    assert.match(loaded.errors[0] ?? "", /global is invalid:/);
    assert.match(loaded.errors[0] ?? "", /additional properties/);
});
