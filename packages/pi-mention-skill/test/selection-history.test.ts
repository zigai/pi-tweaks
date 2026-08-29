import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
    createLazySelectionHistory,
    rankInitialSuggestions,
    rankWithSelectionHistory,
} from "../src/initial-suggestions.ts";
import { createSelectionHistory } from "../src/selection-history.ts";
import type { InitialSuggestionsSettings } from "../src/settings.ts";

const NOW = Date.UTC(2026, 7, 29);
const DAY = 24 * 60 * 60 * 1_000;
const items = ["zeta", "alpha", "beta", "gamma"];
const selections = new Map([
    ["alpha", { count: 2, lastSelectedAt: NOW - DAY }],
    ["beta", { count: 8, lastSelectedAt: NOW - 60 * DAY }],
    ["gamma", { count: 1, lastSelectedAt: NOW }],
]);

function settings(
    strategy: InitialSuggestionsSettings["strategy"],
    pinned: string[] = [],
): InitialSuggestionsSettings {
    return { strategy, pinned, projectSkillsFirst: false };
}

test("rankInitialSuggestions supports every initial ordering strategy", () => {
    assert.deepEqual(
        rankInitialSuggestions(items, String, settings("sourceOrder"), selections, NOW),
        ["zeta", "alpha", "beta", "gamma"],
    );
    assert.deepEqual(
        rankInitialSuggestions(items, String, settings("alphabetical"), selections, NOW),
        ["alpha", "beta", "gamma", "zeta"],
    );
    assert.deepEqual(rankInitialSuggestions(items, String, settings("recent"), selections, NOW), [
        "gamma",
        "alpha",
        "beta",
        "zeta",
    ]);
    assert.deepEqual(rankInitialSuggestions(items, String, settings("frequent"), selections, NOW), [
        "beta",
        "alpha",
        "gamma",
        "zeta",
    ]);
    assert.deepEqual(rankInitialSuggestions(items, String, settings("frecency"), selections, NOW), [
        "beta",
        "alpha",
        "gamma",
        "zeta",
    ]);
});

test("rankInitialSuggestions places configured pins first in configured order", () => {
    assert.deepEqual(
        rankInitialSuggestions(
            items,
            String,
            settings("alphabetical", ["gamma", "zeta"]),
            selections,
            NOW,
        ),
        ["gamma", "zeta", "alpha", "beta"],
    );
});

test("stateless ranking does not load persisted selection history", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pi-mention-skill-lazy-history-"));
    const filePath = path.join(directory, "selections.json");
    const errors: string[] = [];
    try {
        await writeFile(filePath, "invalid", "utf8");
        const history = createLazySelectionHistory({
            filePath,
            onError: (message) => errors.push(message),
        });

        assert.deepEqual(
            await rankWithSelectionHistory(items, String, settings("sourceOrder"), history),
            items,
        );
        assert.deepEqual(errors, []);

        await rankWithSelectionHistory(items, String, settings("recent"), history);
        assert.equal(errors.length, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("createSelectionHistory lazily persists and reloads selections", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pi-mention-skill-history-"));
    const filePath = path.join(directory, "selections.json");
    try {
        const history = createSelectionHistory({ filePath, now: () => NOW });
        history.recordSelection("typescript");
        history.recordSelection("typescript");
        history.recordSelection("readme");
        await history.flush();

        const stored: unknown = JSON.parse(await readFile(filePath, "utf8"));
        assert.deepEqual(stored, {
            version: 1,
            selections: {
                typescript: { count: 2, lastSelectedAt: NOW },
                readme: { count: 1, lastSelectedAt: NOW },
            },
        });

        const reloaded = createSelectionHistory({ filePath, now: () => NOW });
        assert.deepEqual(
            await rankWithSelectionHistory(
                ["readme", "typescript"],
                String,
                settings("frequent"),
                reloaded,
            ),
            ["typescript", "readme"],
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
