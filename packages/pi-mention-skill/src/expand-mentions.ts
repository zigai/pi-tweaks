import fs from "node:fs/promises";
import path from "node:path";

import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import { skillName, stripFrontmatter } from "./skill-commands.ts";
import type { SkillCommand, SkillExpansion } from "./types.ts";
import { escapeRegExp } from "./util.ts";

export type SkillExpansionLoader = (command: SkillCommand) => Promise<SkillExpansion>;

type CachedSkillExpansion = {
    mtimeMs: number;
    expansion: SkillExpansion;
};

async function loadSkillExpansion(command: SkillCommand): Promise<SkillExpansion> {
    const content = await fs.readFile(command.sourceInfo.path, "utf8");
    const body = stripFrontmatter(content).trim();
    const baseDir = command.sourceInfo.baseDir ?? path.dirname(command.sourceInfo.path);
    const name = skillName(command);
    return { name, location: command.sourceInfo.path, body, baseDir };
}

export function createCachedSkillExpansionLoader(): SkillExpansionLoader {
    const cache = new Map<string, CachedSkillExpansion>();

    return async (command) => {
        const filePath = command.sourceInfo.path;
        const stats = await fs.stat(filePath);
        const cached = cache.get(filePath);
        if (cached?.mtimeMs === stats.mtimeMs) {
            return cached.expansion;
        }

        const expansion = await loadSkillExpansion(command);
        cache.set(filePath, { mtimeMs: stats.mtimeMs, expansion });
        return expansion;
    };
}

function formatSkillBlock(expansion: SkillExpansion): string {
    return `<skill name="${expansion.name}" location="${expansion.location}">\nReferences are relative to ${expansion.baseDir}.\n\n${expansion.body}\n</skill>`;
}

function formatCombinedSkillBlock(expansions: SkillExpansion[]): string {
    if (expansions.length === 1) {
        const expansion = expansions[0];
        if (expansion !== undefined) return formatSkillBlock(expansion);
    }

    const names = expansions.map((expansion) => expansion.name).join(", ");
    const content = expansions
        .map((expansion) => {
            return `## ${expansion.name}\n\nReferences are relative to ${expansion.baseDir}.\n\n${expansion.body}`;
        })
        .join("\n\n---\n\n");
    return `<skill name="${names}" location="multiple">\n${content}\n</skill>`;
}

function skillMentionPattern(trigger: string): RegExp {
    return new RegExp(
        `(^|\\s)${escapeRegExp(trigger)}([a-z0-9][a-z0-9-]{0,63})(?=$|\\s|[.,;:!?)}\\]])`,
        "g",
    );
}

function removeSkillMentionSigils(text: string, names: Set<string>, trigger: string): string {
    return text
        .replace(skillMentionPattern(trigger), (match: string, leading: string, name: string) => {
            if (!names.has(name)) return match;
            return `${leading}${name}`;
        })
        .trim();
}

export async function expandSkillMentions(
    text: string,
    skills: SkillCommand[],
    trigger: string,
    loadExpansion: SkillExpansionLoader = loadSkillExpansion,
): Promise<string> {
    const byName = new Map(skills.map((skill) => [skillName(skill), skill]));
    const names = new Set<string>();

    for (const match of text.matchAll(skillMentionPattern(trigger))) {
        const name = match[2];
        if (name !== undefined && byName.has(name)) {
            names.add(name);
        }
    }

    if (names.size === 0) return text;

    const expansions = await Promise.all(
        [...names].map(async (name) => {
            const skill = byName.get(name);
            if (skill === undefined) return undefined;
            return loadExpansion(skill);
        }),
    );
    const loaded = expansions.filter((expansion): expansion is SkillExpansion => {
        return expansion !== undefined;
    });
    if (loaded.length === 0) return text;

    const skillBlock = formatCombinedSkillBlock(loaded);
    const userMessage = removeSkillMentionSigils(text, names, trigger);
    if (userMessage.length === 0) return skillBlock;
    return `${skillBlock}\n\n${userMessage}`;
}

type ContextMessage = ContextEvent["messages"][number];
type UserContextMessage = Extract<ContextMessage, { role: "user" }>;
type UserContentBlock = Exclude<UserContextMessage["content"], string>[number];
type UserTextContentBlock = Extract<UserContentBlock, { type: "text" }>;

function isUserTextContentBlock(block: UserContentBlock): block is UserTextContentBlock {
    return block.type === "text";
}

function firstRecentMessageIndex(messages: ContextEvent["messages"]): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === "assistant") return index + 1;
    }

    return 0;
}

function shouldExpandContextText(text: string, trigger: string): boolean {
    if (!text.includes(trigger)) return false;
    return !text.trimStart().startsWith("<skill ");
}

function recentUserMessageIndexesWithSkillMentionTrigger(
    messages: ContextEvent["messages"],
    trigger: string,
): number[] {
    const indexes: number[] = [];
    for (let index = firstRecentMessageIndex(messages); index < messages.length; index += 1) {
        const message = messages[index];
        if (message?.role !== "user") continue;

        if (typeof message.content === "string") {
            if (shouldExpandContextText(message.content, trigger)) indexes.push(index);
            continue;
        }

        if (
            message.content.some((block) => {
                return (
                    isUserTextContentBlock(block) && shouldExpandContextText(block.text, trigger)
                );
            })
        ) {
            indexes.push(index);
        }
    }

    return indexes;
}

export function contextContainsSkillMentionTrigger(
    messages: ContextEvent["messages"],
    trigger: string,
): boolean {
    return recentUserMessageIndexesWithSkillMentionTrigger(messages, trigger).length > 0;
}

async function expandSkillMentionsInUserMessage(
    message: UserContextMessage,
    skills: SkillCommand[],
    trigger: string,
    loadExpansion: SkillExpansionLoader,
): Promise<UserContextMessage> {
    if (typeof message.content === "string") {
        if (!shouldExpandContextText(message.content, trigger)) return message;
        const expanded = await expandSkillMentions(message.content, skills, trigger, loadExpansion);
        if (expanded === message.content) return message;
        return { ...message, content: expanded };
    }

    let changed = false;
    const content: UserContentBlock[] = [];
    for (const block of message.content) {
        if (!isUserTextContentBlock(block) || !shouldExpandContextText(block.text, trigger)) {
            content.push(block);
            continue;
        }

        const expanded = await expandSkillMentions(block.text, skills, trigger, loadExpansion);
        if (expanded === block.text) {
            content.push(block);
            continue;
        }

        changed = true;
        content.push({ ...block, text: expanded });
    }

    if (!changed) return message;
    return { ...message, content };
}

export async function expandSkillMentionsInMessages(
    messages: ContextEvent["messages"],
    skills: SkillCommand[],
    trigger: string,
    loadExpansion: SkillExpansionLoader = loadSkillExpansion,
): Promise<ContextEvent["messages"]> {
    const indexes = recentUserMessageIndexesWithSkillMentionTrigger(messages, trigger);
    if (indexes.length === 0) return messages;

    let expandedMessages: ContextEvent["messages"] | undefined;

    for (const index of indexes) {
        const message = messages[index];
        if (message?.role !== "user") continue;
        const expanded = await expandSkillMentionsInUserMessage(
            message,
            skills,
            trigger,
            loadExpansion,
        );
        if (expanded === message) continue;

        expandedMessages ??= [...messages];
        expandedMessages[index] = expanded;
    }

    return expandedMessages ?? messages;
}
