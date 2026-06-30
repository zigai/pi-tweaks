import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
    buildHistoryList,
    collectUserPromptsFromEntries,
    historiesMatch,
    loadPromptHistoryForCwd,
} from "../src/prompt-history.ts";
import { getSessionDirForCwd } from "../src/storage.ts";
import type { PromptEntry } from "../src/types.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-prompt-history-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

function userEntry(content: unknown, timestamp: number): SessionEntry {
    return {
        type: "message",
        message: {
            role: "user",
            content,
            timestamp,
        },
    } as unknown as SessionEntry;
}

function assistantEntry(content: string, timestamp: number): SessionEntry {
    return {
        type: "message",
        message: {
            role: "assistant",
            content,
            timestamp,
        },
    } as unknown as SessionEntry;
}

function jsonLine(entry: SessionEntry): string {
    return JSON.stringify(entry);
}

test("collectUserPromptsFromEntries keeps only non-empty user text", () => {
    const entries: SessionEntry[] = [
        userEntry("  first prompt  ", 10),
        assistantEntry("assistant response", 11),
        userEntry("   ", 12),
        userEntry(
            [
                { type: "text", text: "hello " },
                { type: "image", image: "ignored" },
                { type: "text", text: "world" },
            ],
            13,
        ),
    ];

    assert.deepEqual(collectUserPromptsFromEntries(entries), [
        { text: "first prompt", timestamp: 10 },
        { text: "hello world", timestamp: 13 },
    ]);
});

test("loadPromptHistoryForCwd reads recent jsonl files, skips malformed lines, and excludes current session", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-prompt-history-cwd-"));
    const resolvedCwd = path.resolve(cwd);
    const sessionDir = getSessionDirForCwd(resolvedCwd);
    await mkdir(sessionDir, { recursive: true });

    const oldFile = path.join(sessionDir, "old.jsonl");
    const recentFile = path.join(sessionDir, "recent.jsonl");
    const currentFile = path.join(sessionDir, "current.jsonl");

    await writeFile(oldFile, `${jsonLine(userEntry("old prompt", 1))}\n`, "utf8");
    await writeFile(
        recentFile,
        [
            "{ not json",
            jsonLine(assistantEntry("assistant", 2)),
            jsonLine(userEntry("  ", 3)),
            jsonLine(userEntry([{ type: "text", text: "recent prompt" }], 4)),
        ].join("\n") + "\n",
        "utf8",
    );
    await writeFile(currentFile, `${jsonLine(userEntry("current prompt", 5))}\n`, "utf8");

    const oldDate = new Date("2024-01-01T00:00:00.000Z");
    const recentDate = new Date("2024-01-02T00:00:00.000Z");
    const currentDate = new Date("2024-01-03T00:00:00.000Z");
    await utimes(oldFile, oldDate, oldDate);
    await utimes(recentFile, recentDate, recentDate);
    await utimes(currentFile, currentDate, currentDate);

    try {
        const prompts = await loadPromptHistoryForCwd(cwd, currentFile);
        assert.deepEqual(prompts, [
            { text: "recent prompt", timestamp: 4 },
            { text: "old prompt", timestamp: 1 },
        ]);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("buildHistoryList sorts, deduplicates by timestamp and text, and caps history", () => {
    const current: PromptEntry[] = [
        { text: "duplicate", timestamp: 1 },
        { text: "latest", timestamp: 200 },
    ];
    const previous: PromptEntry[] = [{ text: "duplicate", timestamp: 1 }];
    for (let index = 2; index <= 120; index += 1) {
        previous.push({ text: `prompt ${index}`, timestamp: index });
    }

    const history = buildHistoryList(current, previous);

    assert.equal(history.length, 100);
    assert.equal(history[0]?.text, "prompt 22");
    assert.deepEqual(history.at(-1), { text: "latest", timestamp: 200 });
});

test("historiesMatch compares text and timestamp in order", () => {
    const first: PromptEntry[] = [
        { text: "one", timestamp: 1 },
        { text: "two", timestamp: 2 },
    ];
    const same: PromptEntry[] = [
        { text: "one", timestamp: 1 },
        { text: "two", timestamp: 2 },
    ];
    const reordered: PromptEntry[] = [
        { text: "two", timestamp: 2 },
        { text: "one", timestamp: 1 },
    ];

    assert.equal(historiesMatch(first, same), true);
    assert.equal(historiesMatch(first, reordered), false);
});
