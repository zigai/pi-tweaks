import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import {
    parseProjectMentionName,
    projectMentionPattern,
    projectNameSet,
} from "./mention-syntax.ts";
import type { ProjectDirectory } from "./types.ts";

function escapeXmlText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
    return escapeXmlText(value).replace(/"/g, "&quot;");
}

function formatProjectBlock(project: ProjectDirectory): string {
    const name = escapeXmlAttribute(project.name);
    const projectPath = escapeXmlAttribute(project.path);
    const root = escapeXmlAttribute(project.root);
    return `<project name="${name}" path="${projectPath}" root="${root}">\nDirectory: ${escapeXmlText(project.path)}\n</project>`;
}

function formatCombinedProjectBlock(projects: ProjectDirectory[]): string {
    if (projects.length === 1) {
        const project = projects[0];
        if (project !== undefined) return formatProjectBlock(project);
    }

    const content = projects.map((project) => formatProjectBlock(project)).join("\n\n");
    return `<projects>\n${content}\n</projects>`;
}

function projectMap(projects: ProjectDirectory[]): Map<string, ProjectDirectory> {
    const byName = new Map<string, ProjectDirectory>();
    for (const project of projects) {
        if (byName.has(project.name)) continue;
        byName.set(project.name, project);
    }
    return byName;
}

function mentionedProjectNames(
    text: string,
    projects: ProjectDirectory[],
    trigger: string,
): Set<string> {
    const names = new Set<string>();
    const knownNames = projectNameSet(projects);

    for (const match of text.matchAll(projectMentionPattern(trigger))) {
        const parsed = parseProjectMentionName(match[2], match[3], knownNames);
        if (parsed !== undefined) {
            names.add(parsed.name);
        }
    }

    return names;
}

function removeProjectMentionSigils(
    text: string,
    projects: ProjectDirectory[],
    trigger: string,
): string {
    const knownNames = projectNameSet(projects);
    return text
        .replace(
            projectMentionPattern(trigger),
            (
                match: string,
                leading: string,
                quotedName: string | undefined,
                unquotedName: string | undefined,
            ) => {
                const parsed = parseProjectMentionName(quotedName, unquotedName, knownNames);
                if (parsed === undefined) return match;
                return `${leading}${parsed.name}${parsed.suffix}`;
            },
        )
        .trim();
}

export function expandProjectMentions(
    text: string,
    projects: ProjectDirectory[],
    trigger: string,
): string {
    const byName = projectMap(projects);
    const names = mentionedProjectNames(text, projects, trigger);
    if (names.size === 0) return text;

    const loaded: ProjectDirectory[] = [];
    for (const name of names) {
        const project = byName.get(name);
        if (project !== undefined) {
            loaded.push(project);
        }
    }
    if (loaded.length === 0) return text;

    const projectBlock = formatCombinedProjectBlock(loaded);
    const userMessage = removeProjectMentionSigils(text, projects, trigger);
    if (userMessage.length === 0) return projectBlock;
    return `${projectBlock}\n\n${userMessage}`;
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
