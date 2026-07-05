import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import {
    parseProjectMentionName,
    projectMentionPattern,
    projectNameSet,
} from "./mention-syntax.ts";
import type { ProjectDirectory } from "./types.ts";

function projectMap(projects: ProjectDirectory[]): Map<string, ProjectDirectory> {
    const byName = new Map<string, ProjectDirectory>();
    for (const project of projects) {
        if (byName.has(project.name)) continue;
        byName.set(project.name, project);
    }
    return byName;
}

export function expandProjectMentions(
    text: string,
    projects: ProjectDirectory[],
    trigger: string,
): string {
    const byName = projectMap(projects);
    const knownNames = projectNameSet(projects);
    let changed = false;

    const expanded = text.replace(
        projectMentionPattern(trigger),
        (
            match: string,
            leading: string,
            quotedName: string | undefined,
            unquotedName: string | undefined,
        ) => {
            const parsed = parseProjectMentionName(quotedName, unquotedName, knownNames);
            if (parsed === undefined) return match;

            const project = byName.get(parsed.name);
            if (project === undefined) return match;

            changed = true;
            return `${leading}${project.path}${parsed.suffix}`;
        },
    );

    if (!changed) return text;
    return expanded;
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
    const trimmed = text.trimStart();
    if (trimmed.startsWith("<project ")) return false;
    return !trimmed.startsWith("<projects>");
}

function recentUserMessageIndexesWithProjectMentionTrigger(
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

export function contextContainsProjectMentionTrigger(
    messages: ContextEvent["messages"],
    trigger: string,
): boolean {
    return recentUserMessageIndexesWithProjectMentionTrigger(messages, trigger).length > 0;
}

function expandProjectMentionsInUserMessage(
    message: UserContextMessage,
    projects: ProjectDirectory[],
    trigger: string,
): UserContextMessage {
    if (typeof message.content === "string") {
        if (!shouldExpandContextText(message.content, trigger)) return message;
        const expanded = expandProjectMentions(message.content, projects, trigger);
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

        const expanded = expandProjectMentions(block.text, projects, trigger);
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

export function expandProjectMentionsInMessages(
    messages: ContextEvent["messages"],
    projects: ProjectDirectory[],
    trigger: string,
): ContextEvent["messages"] {
    const indexes = recentUserMessageIndexesWithProjectMentionTrigger(messages, trigger);
    if (indexes.length === 0) return messages;

    let expandedMessages: ContextEvent["messages"] | undefined;

    for (const index of indexes) {
        const message = messages[index];
        if (message?.role !== "user") continue;
        const expanded = expandProjectMentionsInUserMessage(message, projects, trigger);
        if (expanded === message) continue;

        expandedMessages ??= [...messages];
        expandedMessages[index] = expanded;
    }

    return expandedMessages ?? messages;
}
