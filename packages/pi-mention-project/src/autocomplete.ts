import {
    type AutocompleteItem,
    type AutocompleteProvider,
    type AutocompleteSuggestions,
    fuzzyFilter,
} from "@earendil-works/pi-tui";

import {
    autocompleteTriggerCharacter,
    extractProjectMentionPrefix,
    formatProjectMention,
} from "./mention-syntax.ts";
import type { ProjectDirectory } from "./projects.ts";
import { rankWithSelectionHistory, type SelectionHistory } from "./initial-suggestions.ts";
import { DEFAULT_MENTION_TRIGGER, type MentionProjectSettings } from "./settings.ts";

type ProjectLoader = (options?: { readonly signal?: AbortSignal }) => Promise<ProjectDirectory[]>;
type MentionCompletion = ReturnType<AutocompleteProvider["applyCompletion"]>;

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
): MentionCompletion {
    const textBeforeCursor = `${beforePrefix}${value}${suffix}`;
    const replacementLines = `${textBeforeCursor}${afterCursor}`.split("\n");
    const cursorLines = textBeforeCursor.split("\n");
    return {
        lines: [...lines.slice(0, cursorLine), ...replacementLines, ...lines.slice(cursorLine + 1)],
        cursorLine: cursorLine + cursorLines.length - 1,
        cursorCol: lastLineLength(cursorLines),
    };
}

function projectToItem(
    project: ProjectDirectory,
    trigger = DEFAULT_MENTION_TRIGGER,
): AutocompleteItem {
    const value = formatProjectMention(project.name, trigger);
    return {
        value,
        label: project.name,
        description: project.path,
    };
}

async function filterProjects(
    projects: ProjectDirectory[],
    query: string,
    settings: MentionProjectSettings,
    history: SelectionHistory | undefined,
): Promise<AutocompleteItem[]> {
    if (query.length === 0) {
        const ranked = await rankWithSelectionHistory(
            projects,
            (project) => project.name,
            settings.initialSuggestions,
            history,
        );
        return ranked.map((project) => projectToItem(project, settings.trigger));
    }

    return fuzzyFilter(projects, query, (project) => `${project.name} ${project.path}`).map(
        (project) => projectToItem(project, settings.trigger),
    );
}

export function createProjectMentionProvider(
    current: AutocompleteProvider,
    settings: MentionProjectSettings,
    loadProjects: ProjectLoader,
    history?: SelectionHistory,
): AutocompleteProvider {
    const { trigger, completionSuffix } = settings;

    const provider = {
        triggerCharacters: [autocompleteTriggerCharacter(trigger)],

        async getSuggestions(
            lines: string[],
            cursorLine: number,
            cursorCol: number,
            options: { signal: AbortSignal; force?: boolean },
        ): Promise<AutocompleteSuggestions | null> {
            const line = lines[cursorLine] ?? "";
            const beforeCursor = line.slice(0, cursorCol);
            const mention = extractProjectMentionPrefix(beforeCursor, trigger);
            if (mention === undefined) {
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
            }

            if (options.signal.aborted) {
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
            }

            const projects = await loadProjects({ signal: options.signal });
            if (options.signal.aborted || projects.length === 0) {
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
            }

            const items = await filterProjects(projects, mention.query, settings, history);
            if (options.signal.aborted) {
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
            }
            if (items.length === 0) {
                return current.getSuggestions(lines, cursorLine, cursorCol, options);
            }
            return { prefix: mention.prefix, items };
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
            history?.recordSelection(item.label);
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
