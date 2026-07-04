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

function shouldExpandContextText(text: string, trigger: string): boolean {
    if (!text.includes(trigger)) return false;
    const trimmed = text.trimStart();
    if (trimmed.startsWith("<project ")) return false;
    return !trimmed.startsWith("<projects>");
}

export function contextContainsProjectMentionTrigger(
    messages: ContextEvent["messages"],
    trigger: string,
): boolean {
    return messages.some((message) => {
        if (message.role !== "user") return false;
        if (typeof message.content === "string") {
            return shouldExpandContextText(message.content, trigger);
        }
        return message.content.some((block) => {
            return isUserTextContentBlock(block) && shouldExpandContextText(block.text, trigger);
        });
    });
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
    let changed = false;
    const expandedMessages: ContextEvent["messages"] = [];

    for (const message of messages) {
        if (message.role !== "user") {
            expandedMessages.push(message);
            continue;
        }

        const expanded = expandProjectMentionsInUserMessage(message, projects, trigger);
        if (expanded !== message) changed = true;
        expandedMessages.push(expanded);
    }

    if (!changed) return messages;
    return expandedMessages;
}
