import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { createSkillMentionProvider } from "../src/autocomplete.ts";
import type { SkillCommand } from "../src/types.ts";

function skillCommand(name: string, description = "test skill"): SkillCommand {
    return {
        source: "skill",
        name: `skill:${name}`,
        description,
        sourceInfo: {
            path: `/tmp/${name}.md`,
        },
    } as unknown as SkillCommand;
}

function fakePi(commands: SkillCommand[]): ExtensionAPI {
    return {
        getCommands() {
            return commands;
        },
    } as unknown as ExtensionAPI;
}

function fallbackProvider(items: AutocompleteItem[]): AutocompleteProvider {
    return {
        async getSuggestions() {
            return { prefix: "/", items };
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
            return { lines, cursorLine, cursorCol: cursorCol + item.value.length - prefix.length };
        },
        shouldTriggerFileCompletion() {
            return false;
        },
    };
}

void test("createSkillMentionProvider suggests skills after the configured trigger", async () => {
    const provider = createSkillMentionProvider(
        fakePi([skillCommand("python", "Python workflows"), skillCommand("review", "Code review")]),
        fallbackProvider([]),
        { trigger: "$", hideSlashSkills: true, completionSuffix: " " },
    );

    const suggestions = await provider.getSuggestions(["Use $py"], 0, "Use $py".length, {
        signal: new AbortController().signal,
    });

    assert.equal(suggestions?.prefix, "$py");
    assert.deepEqual(
        suggestions?.items.map((item) => item.value),
        ["$python"],
    );
    assert.deepEqual(
        suggestions?.items.map((item) => item.label),
        ["python"],
    );
});

void test("createSkillMentionProvider falls back outside mention context and can hide slash skills", async () => {
    const provider = createSkillMentionProvider(
        fakePi([skillCommand("python")]),
        fallbackProvider([
            { value: "skill:python", label: "/skill python" },
            { value: "help", label: "/help" },
        ]),
        { trigger: "$", hideSlashSkills: true, completionSuffix: " " },
    );

    const suggestions = await provider.getSuggestions(["/"], 0, 1, {
        signal: new AbortController().signal,
    });

    assert.deepEqual(suggestions, { prefix: "/", items: [{ value: "help", label: "/help" }] });
});

void test("createSkillMentionProvider returns null when hidden slash skills are the only fallback items", async () => {
    const provider = createSkillMentionProvider(
        fakePi([skillCommand("python")]),
        fallbackProvider([{ value: "skill:python", label: "/skill python" }]),
        { trigger: "$", hideSlashSkills: true, completionSuffix: " " },
    );

    const suggestions = await provider.getSuggestions(["/"], 0, 1, {
        signal: new AbortController().signal,
    });

    assert.equal(suggestions, null);
});

void test("applyCompletion replaces the mention prefix and inserts a trailing space when needed", () => {
    const provider = createSkillMentionProvider(fakePi([]), fallbackProvider([]), {
        trigger: "$",
        hideSlashSkills: true,
        completionSuffix: " ",
    });

    const result = provider.applyCompletion(
        ["Use $py"],
        0,
        "Use $py".length,
        { value: "$python", label: "$python" },
        "$py",
    );

    assert.deepEqual(result, {
        lines: ["Use $python "],
        cursorLine: 0,
        cursorCol: "Use $python ".length,
    });
});

void test("applyCompletion uses the configured completion suffix", () => {
    const provider = createSkillMentionProvider(fakePi([]), fallbackProvider([]), {
        trigger: "$",
        hideSlashSkills: true,
        completionSuffix: "\n",
    });

    const result = provider.applyCompletion(
        ["Use $py"],
        0,
        "Use $py".length,
        { value: "$python", label: "$python" },
        "$py",
    );

    assert.deepEqual(result, {
        lines: ["Use $python", ""],
        cursorLine: 1,
        cursorCol: 0,
    });
});
