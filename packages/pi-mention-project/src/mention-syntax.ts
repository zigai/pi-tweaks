import type { ProjectDirectory } from "./types.ts";
import { escapeRegExp } from "./util.ts";

const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "}", "]"]);

export type ParsedProjectMention = {
    name: string;
    suffix: string;
};

export type ProjectMentionPrefix = {
    prefix: string;
    query: string;
};

export function projectMentionPattern(trigger: string): RegExp {
    return new RegExp(`(^|\\s)${escapeRegExp(trigger)}(?:"((?:\\\\.|[^"\\\\])*)"|([^\\s]+))`, "g");
}

function unescapeQuotedName(value: string): string {
    return value.replace(/\\(["\\])/g, "$1");
}

function escapeQuotedName(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isBareProjectName(name: string, trigger: string): boolean {
    if (name.length === 0) return false;
    if (name.includes(trigger)) return false;
    return /^[^\s"'/]+$/.test(name);
}

export function formatProjectMention(name: string, trigger: string): string {
    if (isBareProjectName(name, trigger)) return `${trigger}${name}`;
    return `${trigger}"${escapeQuotedName(name)}"`;
}

function parseUnquotedName(
    rawName: string,
    knownNames: ReadonlySet<string>,
): ParsedProjectMention | undefined {
    if (knownNames.has(rawName)) {
        return { name: rawName, suffix: "" };
    }

    let end = rawName.length;
    while (end > 0) {
        const last = rawName[end - 1];
        if (last === undefined || !TRAILING_PUNCTUATION.has(last)) break;
        end -= 1;
        const candidate = rawName.slice(0, end);
        if (knownNames.has(candidate)) {
            return { name: candidate, suffix: rawName.slice(end) };
        }
    }

    return undefined;
}

export function parseProjectMentionName(
    quotedName: string | undefined,
    unquotedName: string | undefined,
    knownNames: ReadonlySet<string>,
): ParsedProjectMention | undefined {
    if (quotedName !== undefined) {
        const name = unescapeQuotedName(quotedName);
        if (!knownNames.has(name)) return undefined;
        return { name, suffix: "" };
    }

    if (unquotedName === undefined) return undefined;
    return parseUnquotedName(unquotedName, knownNames);
}

export function projectNameSet(projects: ReadonlyArray<ProjectDirectory>): Set<string> {
    return new Set(projects.map((project) => project.name));
}

export function extractProjectMentionPrefix(
    textBeforeCursor: string,
    trigger: string,
): ProjectMentionPrefix | undefined {
    const escapedTrigger = escapeRegExp(trigger);
    const quotedMatch = new RegExp(`(?:^|\\s)(${escapedTrigger}"([^"]*)$)`).exec(textBeforeCursor);
    if (quotedMatch?.[1] !== undefined && quotedMatch[2] !== undefined) {
        return { prefix: quotedMatch[1], query: quotedMatch[2] };
    }

    const match = new RegExp(`(?:^|\\s)(${escapedTrigger}([^\\s"]*)$)`).exec(textBeforeCursor);
    if (match?.[1] !== undefined && match[2] !== undefined) {
        return { prefix: match[1], query: match[2] };
    }
    return undefined;
}

export function extractProjectToken(textBeforeCursor: string, trigger: string): string | undefined {
    return extractProjectMentionPrefix(textBeforeCursor, trigger)?.query;
}

export function isProjectMentionContext(text: string, trigger: string): boolean {
    return extractProjectMentionPrefix(text, trigger) !== undefined;
}
