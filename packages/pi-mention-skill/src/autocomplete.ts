import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    type AutocompleteItem,
    type AutocompleteProvider,
    type AutocompleteSuggestions,
    fuzzyFilter,
} from "@earendil-works/pi-tui";

import { DEFAULT_MENTION_TRIGGER } from "./settings.ts";
import { getSkillCommands, skillName } from "./skill-commands.ts";
import type { MentionSkillSettings, SkillCommand } from "./types.ts";
import { escapeRegExp } from "./util.ts";

const MAX_SUGGESTIONS = 20;
const SKILL_COMMAND_PREFIX = "skill:";

function skillToItem(command: SkillCommand, trigger = DEFAULT_MENTION_TRIGGER): AutocompleteItem {
    const name = skillName(command);
    return {
        value: `${trigger}${name}`,
        label: name,
        description: command.description,
    };
}

function extractSkillToken(textBeforeCursor: string, trigger: string): string | undefined {
    const escapedTrigger = escapeRegExp(trigger);
    const match = new RegExp(`(?:^|\\s)${escapedTrigger}([a-z0-9-]*)$`).exec(textBeforeCursor);
    return match?.[1];
}

function filterSkills(skills: SkillCommand[], query: string, trigger: string): AutocompleteItem[] {
    if (query.length === 0) {
        return skills.slice(0, MAX_SUGGESTIONS).map((skill) => skillToItem(skill, trigger));
    }

    return fuzzyFilter(skills, query, (skill) => `${skillName(skill)} ${skill.description}`)
        .slice(0, MAX_SUGGESTIONS)
        .map((skill) => skillToItem(skill, trigger));
}

function filterSlashSkillSuggestions(
    suggestions: AutocompleteSuggestions | null,
    hideSlashSkills: boolean,
): AutocompleteSuggestions | null {
    if (!hideSlashSkills || suggestions === null || !suggestions.prefix.startsWith("/")) {
        return suggestions;
    }

    const items = suggestions.items.filter((item) => !item.value.startsWith(SKILL_COMMAND_PREFIX));
    if (items.length === suggestions.items.length) return suggestions;
    if (items.length === 0) return null;
    return { ...suggestions, items };
}

function completionSuffixFor(afterCursor: string, completionSuffix: string): string {
    if (completionSuffix.length === 0) {
        return "";
    }
    if (afterCursor.length === 0) {
        return completionSuffix;
    }
    if (/^\s/.test(completionSuffix) && /^\s/.test(afterCursor)) {
        return "";
    }
    return completionSuffix;
}

function lastLineLength(lines: string[]): number {
    const lastLine = lines[lines.length - 1];
    if (lastLine === undefined) {
        return 0;
    }
    return lastLine.length;
}

function applyMentionCompletion(
    lines: string[],
    cursorLine: number,
    beforePrefix: string,
    value: string,
    suffix: string,
    afterCursor: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
    const textBeforeCursor = `${beforePrefix}${value}${suffix}`;
    const replacementLines = `${textBeforeCursor}${afterCursor}`.split("\n");
    const cursorLines = textBeforeCursor.split("\n");
    return {
        lines: [...lines.slice(0, cursorLine), ...replacementLines, ...lines.slice(cursorLine + 1)],
        cursorLine: cursorLine + cursorLines.length - 1,
        cursorCol: lastLineLength(cursorLines),
    };
}

export function createSkillMentionProvider(
    pi: ExtensionAPI,
    current: AutocompleteProvider,
    settings: MentionSkillSettings,
): AutocompleteProvider {
    const { trigger, hideSlashSkills, completionSuffix } = settings;
    const getFallbackSuggestions = async (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        options: { signal: AbortSignal; force?: boolean },
    ): Promise<AutocompleteSuggestions | null> => {
        const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
        return filterSlashSkillSuggestions(suggestions, hideSlashSkills);
    };

    const provider = {
        triggerCharacters: [trigger],

        async getSuggestions(
            lines: string[],
            cursorLine: number,
            cursorCol: number,
            options: { signal: AbortSignal; force?: boolean },
        ): Promise<AutocompleteSuggestions | null> {
            const line = lines[cursorLine] ?? "";
            const beforeCursor = line.slice(0, cursorCol);
            const token = extractSkillToken(beforeCursor, trigger);
            if (token === undefined) {
                return getFallbackSuggestions(lines, cursorLine, cursorCol, options);
            }

            const items = filterSkills(getSkillCommands(pi), token, trigger);
            if (items.length === 0) {
                return getFallbackSuggestions(lines, cursorLine, cursorCol, options);
            }
            return { prefix: `${trigger}${token}`, items };
        },

        applyCompletion(
            lines: string[],
            cursorLine: number,
            cursorCol: number,
            item: AutocompleteItem,
            prefix: string,
        ) {
            if (!prefix.startsWith(trigger)) {
                return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
            }

            const currentLine = lines[cursorLine] ?? "";
            const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
            const afterCursor = currentLine.slice(cursorCol);
            const suffix = completionSuffixFor(afterCursor, completionSuffix);
            return applyMentionCompletion(
                lines,
                cursorLine,
                beforePrefix,
                item.value,
                suffix,
                afterCursor,
            );
        },

        shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number) {
            return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
    };

    return provider;
}
