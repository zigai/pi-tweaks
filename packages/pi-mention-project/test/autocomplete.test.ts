import assert from "node:assert/strict";
import test from "node:test";

import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

import { createProjectMentionProvider } from "../src/autocomplete.ts";
import type { MentionProjectSettings, ProjectDirectory } from "../src/types.ts";

function project(name: string, root = "/tmp/projects"): ProjectDirectory {
    return {
        name,
        root,
        path: `${root}/${name}`,
    };
}

function settings(roots: string[]): MentionProjectSettings {
    return {
        trigger: "#",
        roots,
        gitReposOnly: true,
        includeDotFolders: false,
        completionSuffix: " ",
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

void test("createProjectMentionProvider suggests projects after the configured trigger", async () => {
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        settings(["/tmp/projects"]),
        async () => [project("pi-tweaks"), project("work-api")],
    );

    const suggestions = await provider.getSuggestions(["Use #twe"], 0, "Use #twe".length, {
        signal: new AbortController().signal,
    });

    assert.equal(suggestions?.prefix, "#twe");
    assert.deepEqual(
        suggestions?.items.map((item) => item.value),
        ["#pi-tweaks"],
    );
    assert.deepEqual(
        suggestions?.items.map((item) => item.label),
        ["pi-tweaks"],
    );
});

void test("createProjectMentionProvider falls back outside project mention context", async () => {
    const provider = createProjectMentionProvider(
        fallbackProvider([{ value: "help", label: "/help" }]),
        settings(["/tmp/projects"]),
        async () => [project("pi-tweaks")],
    );

    const suggestions = await provider.getSuggestions(["abc#tw"], 0, "abc#tw".length, {
        signal: new AbortController().signal,
    });

    assert.deepEqual(suggestions, { prefix: "/", items: [{ value: "help", label: "/help" }] });
});

void test("createProjectMentionProvider quotes project names that need quoting", async () => {
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        settings(["/tmp/projects"]),
        async () => [project("My Project")],
    );

    const suggestions = await provider.getSuggestions(["Use #my"], 0, "Use #my".length, {
        signal: new AbortController().signal,
    });

    assert.deepEqual(
        suggestions?.items.map((item) => item.value),
        ['#"My Project"'],
    );
    assert.deepEqual(
        suggestions?.items.map((item) => item.label),
        ["My Project"],
    );
});

void test("applyCompletion replaces the mention prefix and inserts a trailing space when needed", () => {
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        settings([]),
        async () => [],
    );

    const result = provider.applyCompletion(
        ["Use #pi"],
        0,
        "Use #pi".length,
        { value: "#pi-tweaks", label: "#pi-tweaks" },
        "#pi",
    );

    assert.deepEqual(result, {
        lines: ["Use #pi-tweaks "],
        cursorLine: 0,
        cursorCol: "Use #pi-tweaks ".length,
    });
});

void test("applyCompletion uses the configured completion suffix", () => {
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        { ...settings([]), completionSuffix: "\n" },
        async () => [],
    );

    const result = provider.applyCompletion(
        ["Use #pi"],
        0,
        "Use #pi".length,
        { value: "#pi-tweaks", label: "#pi-tweaks" },
        "#pi",
    );

    assert.deepEqual(result, {
        lines: ["Use #pi-tweaks", ""],
        cursorLine: 1,
        cursorCol: 0,
    });
});
