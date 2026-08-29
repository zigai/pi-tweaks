import assert from "node:assert/strict";
import { test } from "vitest";

import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

import { createProjectMentionProvider } from "../src/autocomplete.ts";
import type { ProjectDirectory } from "../src/projects.ts";
import type { SelectionHistory } from "../src/initial-suggestions.ts";
import type { MentionProjectSettings } from "../src/settings.ts";

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
        initialSuggestions: { strategy: "frecency", pinned: [] },
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

test("createProjectMentionProvider suggests projects after the configured trigger", async () => {
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

test("createProjectMentionProvider supports multi-character triggers", async () => {
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        { ...settings(["/tmp/projects"]), trigger: "project:" },
        async () => [project("pi-tweaks")],
    );

    assert.deepEqual(provider.triggerCharacters, ["p"]);
    const suggestions = await provider.getSuggestions(
        ["Use project:twe"],
        0,
        "Use project:twe".length,
        {
            signal: new AbortController().signal,
        },
    );

    assert.equal(suggestions?.prefix, "project:twe");
    assert.deepEqual(
        suggestions?.items.map((item) => item.value),
        ["project:pi-tweaks"],
    );

    const result = provider.applyCompletion(
        ["Use project:twe"],
        0,
        "Use project:twe".length,
        { value: "project:pi-tweaks", label: "pi-tweaks" },
        "project:twe",
    );
    assert.deepEqual(result, {
        lines: ["Use project:pi-tweaks "],
        cursorLine: 0,
        cursorCol: "Use project:pi-tweaks ".length,
    });
});

test("createProjectMentionProvider returns all projects for empty browse", async () => {
    const projects = Array.from({ length: 25 }, (_value, index) => {
        return project(`project-${index.toString().padStart(2, "0")}`);
    });
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        settings(["/tmp/projects"]),
        async () => projects,
    );

    const suggestions = await provider.getSuggestions(["Use #"], 0, "Use #".length, {
        signal: new AbortController().signal,
    });

    assert.equal(suggestions?.prefix, "#");
    assert.equal(suggestions?.items.length, 25);
    assert.equal(suggestions?.items.at(-1)?.value, "#project-24");
});

test("createProjectMentionProvider skips project loading when completion is aborted", async () => {
    let loadCount = 0;
    const provider = createProjectMentionProvider(
        fallbackProvider([{ value: "help", label: "/help" }]),
        settings(["/tmp/projects"]),
        async () => {
            loadCount += 1;
            return [project("pi-tweaks")];
        },
    );
    const controller = new AbortController();
    controller.abort();

    const suggestions = await provider.getSuggestions(["Use #twe"], 0, "Use #twe".length, {
        signal: controller.signal,
    });

    assert.equal(loadCount, 0);
    assert.deepEqual(suggestions, { prefix: "/", items: [{ value: "help", label: "/help" }] });
});

test("createProjectMentionProvider passes autocomplete cancellation to project loading", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        settings(["/tmp/projects"]),
        async (options) => {
            receivedSignal = options?.signal;
            return [];
        },
    );

    await provider.getSuggestions(["Use #twe"], 0, "Use #twe".length, {
        signal: controller.signal,
    });

    assert.equal(receivedSignal, controller.signal);
});

test("createProjectMentionProvider falls back outside project mention context", async () => {
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

test("createProjectMentionProvider quotes project names that need quoting", async () => {
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

test("applyCompletion replaces the mention prefix and inserts a trailing space when needed", () => {
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

test("applyCompletion uses the configured completion suffix", () => {
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

test("initial project suggestions use configured ranking and record completions", async () => {
    const recorded: string[] = [];
    const history: SelectionHistory = {
        async load() {
            return new Map([
                ["work-api", { count: 1, lastSelectedAt: 1 }],
                ["pi-tweaks", { count: 2, lastSelectedAt: 2 }],
            ]);
        },
        recordSelection(name) {
            recorded.push(name);
        },
        async flush() {},
    };
    const provider = createProjectMentionProvider(
        fallbackProvider([]),
        {
            ...settings([]),
            initialSuggestions: { strategy: "recent", pinned: ["docs"] },
        },
        async () => [project("work-api"), project("docs"), project("pi-tweaks")],
        history,
    );

    const suggestions = await provider.getSuggestions(["Use #"], 0, "Use #".length, {
        signal: new AbortController().signal,
    });
    assert.deepEqual(
        suggestions?.items.map((item) => item.label),
        ["docs", "pi-tweaks", "work-api"],
    );

    provider.applyCompletion(
        ["Use #pi"],
        0,
        "Use #pi".length,
        { value: "#pi-tweaks", label: "pi-tweaks" },
        "#pi",
    );
    assert.deepEqual(recorded, ["pi-tweaks"]);
});
