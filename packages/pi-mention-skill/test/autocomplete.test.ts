import assert from "node:assert/strict";
import { test } from "vitest";

import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { createSkillMentionProvider } from "../src/autocomplete.ts";
import type { SelectionHistory } from "../src/initial-suggestions.ts";
import type { MentionSkillSettings } from "../src/settings.ts";
import type { SkillCommand } from "../src/skill-commands.ts";

function settings(overrides: Partial<MentionSkillSettings> = {}): MentionSkillSettings {
    return {
        trigger: "$",
        hideSlashSkills: true,
        completionSuffix: " ",
        initialSuggestions: {
            strategy: "frecency",
            pinned: [],
            projectSkillsFirst: false,
        },
        ...overrides,
    };
}

function skillCommand(
    name: string,
    description = "test skill",
    scope: SkillCommand["sourceInfo"]["scope"] = "project",
): SkillCommand {
    return {
        source: "skill",
        name: `skill:${name}`,
        description,
        sourceInfo: {
            path: `/tmp/${name}.md`,
            source: "skill",
            scope,
            origin: "top-level",
        },
    };
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

test("createSkillMentionProvider suggests skills after the configured trigger", async () => {
    const provider = createSkillMentionProvider(fallbackProvider([]), settings(), () => [
        skillCommand("python", "Python workflows"),
        skillCommand("review", "Code review"),
    ]);

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

test("createSkillMentionProvider supports multi-character triggers", async () => {
    const provider = createSkillMentionProvider(
        fallbackProvider([]),
        settings({ trigger: "skill:" }),
        () => [skillCommand("python", "Python workflows")],
    );

    assert.deepEqual(provider.triggerCharacters, ["s"]);
    const suggestions = await provider.getSuggestions(["Use skill:py"], 0, "Use skill:py".length, {
        signal: new AbortController().signal,
    });

    assert.equal(suggestions?.prefix, "skill:py");
    assert.deepEqual(
        suggestions?.items.map((item) => item.value),
        ["skill:python"],
    );

    const result = provider.applyCompletion(
        ["Use skill:py"],
        0,
        "Use skill:py".length,
        { value: "skill:python", label: "python" },
        "skill:py",
    );
    assert.deepEqual(result, {
        lines: ["Use skill:python "],
        cursorLine: 0,
        cursorCol: "Use skill:python ".length,
    });
});

test("createSkillMentionProvider falls back outside mention context and can hide slash skills", async () => {
    const provider = createSkillMentionProvider(
        fallbackProvider([
            { value: "skill:python", label: "/skill python" },
            { value: "help", label: "/help" },
        ]),
        settings(),
        () => [skillCommand("python")],
    );

    const suggestions = await provider.getSuggestions(["/"], 0, 1, {
        signal: new AbortController().signal,
    });

    assert.deepEqual(suggestions, { prefix: "/", items: [{ value: "help", label: "/help" }] });
});

test("createSkillMentionProvider returns null when hidden slash skills are the only fallback items", async () => {
    const provider = createSkillMentionProvider(
        fallbackProvider([{ value: "skill:python", label: "/skill python" }]),
        settings(),
        () => [skillCommand("python")],
    );

    const suggestions = await provider.getSuggestions(["/"], 0, 1, {
        signal: new AbortController().signal,
    });

    assert.equal(suggestions, null);
});

test("applyCompletion replaces the mention prefix and inserts a trailing space when needed", () => {
    const provider = createSkillMentionProvider(fallbackProvider([]), settings(), () => []);

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

test("applyCompletion uses the configured completion suffix", () => {
    const provider = createSkillMentionProvider(
        fallbackProvider([]),
        settings({ completionSuffix: "\n" }),
        () => [],
    );

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

test("initial skill suggestions honor pins and project-local priority before recording completions", async () => {
    const recorded: string[] = [];
    const history: SelectionHistory = {
        async load() {
            return new Map([
                ["python", { count: 1, lastSelectedAt: 3 }],
                ["typescript", { count: 2, lastSelectedAt: 2 }],
            ]);
        },
        recordSelection(name) {
            recorded.push(name);
        },
        async flush() {},
    };
    const provider = createSkillMentionProvider(
        fallbackProvider([]),
        settings({
            initialSuggestions: {
                strategy: "recent",
                pinned: ["review"],
                projectSkillsFirst: true,
            },
        }),
        () => [
            skillCommand("python", "Python workflows", "user"),
            skillCommand("review", "Code review", "user"),
            skillCommand("typescript", "TypeScript workflows", "project"),
        ],
        history,
    );

    const suggestions = await provider.getSuggestions(["Use $"], 0, "Use $".length, {
        signal: new AbortController().signal,
    });
    assert.deepEqual(
        suggestions?.items.map((item) => item.label),
        ["review", "typescript", "python"],
    );

    provider.applyCompletion(
        ["Use $type"],
        0,
        "Use $type".length,
        { value: "$typescript", label: "typescript" },
        "$type",
    );
    assert.deepEqual(recorded, ["typescript"]);
});

test("skill suggestions are not capped by the extension", async () => {
    const skills = Array.from({ length: 25 }, (_value, index) => skillCommand(`skill-${index}`));
    const provider = createSkillMentionProvider(
        fallbackProvider([]),
        settings({
            initialSuggestions: {
                strategy: "sourceOrder",
                pinned: [],
                projectSkillsFirst: false,
            },
        }),
        () => skills,
    );

    const suggestions = await provider.getSuggestions(["Use $"], 0, "Use $".length, {
        signal: new AbortController().signal,
    });
    assert.equal(suggestions?.items.length, 25);
});
