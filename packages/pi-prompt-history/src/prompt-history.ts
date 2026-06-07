import type { ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { MAX_HISTORY_ENTRIES, MAX_RECENT_PROMPTS } from "./constants.ts";
import { getSessionDirForCwd } from "./storage.ts";
import type { PromptEntry } from "./types.ts";

type UserMessageEntry = SessionMessageEntry & {
    message: UserMessage;
};

function isUserMessageEntry(entry: SessionEntry): entry is UserMessageEntry {
    return entry.type === "message" && entry.message.role === "user";
}

function isTextContent(item: TextContent | ImageContent): item is TextContent {
    return item.type === "text";
}

function extractText(content: UserMessage["content"]): string {
    if (typeof content === "string") return content.trim();
    return content
        .filter(isTextContent)
        .map((item) => item.text)
        .join("")
        .trim();
}

export function collectUserPromptsFromEntries(entries: SessionEntry[]): PromptEntry[] {
    const prompts: PromptEntry[] = [];

    for (const entry of entries) {
        if (!isUserMessageEntry(entry)) continue;
        const text = extractText(entry.message.content);
        if (text.length === 0) continue;
        prompts.push({ text, timestamp: entry.message.timestamp });
    }

    return prompts;
}

async function readTail(filePath: string, maxBytes = 256 * 1024): Promise<string> {
    let fileHandle: fs.FileHandle | undefined;
    try {
        const stats = await fs.stat(filePath);
        const size = stats.size;
        const start = Math.max(0, size - maxBytes);
        const length = size - start;
        if (length <= 0) return "";

        const buffer = Buffer.alloc(length);
        fileHandle = await fs.open(filePath, "r");
        const { bytesRead } = await fileHandle.read(buffer, 0, length, start);
        if (bytesRead === 0) return "";
        let chunk = buffer.subarray(0, bytesRead).toString("utf8");
        if (start > 0) {
            const firstNewline = chunk.indexOf("\n");
            if (firstNewline !== -1) {
                chunk = chunk.slice(firstNewline + 1);
            }
        }
        return chunk;
    } catch {
        return "";
    } finally {
        await fileHandle?.close();
    }
}

export async function loadPromptHistoryForCwd(
    cwd: string,
    excludeSessionFile?: string,
): Promise<PromptEntry[]> {
    const sessionDir = getSessionDirForCwd(path.resolve(cwd));
    let resolvedExclude: string | undefined;
    if (excludeSessionFile !== undefined && excludeSessionFile.length > 0) {
        resolvedExclude = path.resolve(excludeSessionFile);
    }
    const prompts: PromptEntry[] = [];

    let entries: Dirent[] = [];
    try {
        entries = await fs.readdir(sessionDir, { withFileTypes: true });
    } catch {
        return prompts;
    }

    const files = await Promise.all(
        entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
            .map(async (entry) => {
                const filePath = path.join(sessionDir, entry.name);
                try {
                    const stats = await fs.stat(filePath);
                    return { filePath, mtimeMs: stats.mtimeMs };
                } catch {
                    return undefined;
                }
            }),
    );

    const sortedFiles = files
        .filter((file): file is { filePath: string; mtimeMs: number } => file !== undefined)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const file of sortedFiles) {
        if (resolvedExclude !== undefined && path.resolve(file.filePath) === resolvedExclude) {
            continue;
        }

        const tail = await readTail(file.filePath);
        if (tail.length === 0) continue;
        const lines = tail.split("\n").filter((line) => line.length > 0);
        for (const line of lines) {
            let entry: SessionEntry;
            try {
                entry = JSON.parse(line) as SessionEntry;
            } catch {
                continue;
            }
            if (!isUserMessageEntry(entry)) continue;
            const text = extractText(entry.message.content);
            if (text.length === 0) continue;
            prompts.push({ text, timestamp: entry.message.timestamp });
            if (prompts.length >= MAX_RECENT_PROMPTS) break;
        }
        if (prompts.length >= MAX_RECENT_PROMPTS) break;
    }

    return prompts;
}

export function buildHistoryList(
    currentSession: PromptEntry[],
    previousSessions: PromptEntry[],
): PromptEntry[] {
    const all = [...currentSession, ...previousSessions];
    all.sort((a, b) => a.timestamp - b.timestamp);

    const seen = new Set<string>();
    const deduped: PromptEntry[] = [];
    for (const prompt of all) {
        const key = `${prompt.timestamp}:${prompt.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(prompt);
    }

    return deduped.slice(-MAX_HISTORY_ENTRIES);
}

export function historiesMatch(a: PromptEntry[], b: PromptEntry[]): boolean {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
        if (a[index]?.text !== b[index]?.text || a[index]?.timestamp !== b[index]?.timestamp) {
            return false;
        }
    }
    return true;
}
