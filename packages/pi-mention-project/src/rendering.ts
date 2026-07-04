import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    isProjectMentionContext,
    parseProjectMentionName,
    projectMentionPattern,
} from "./mention-syntax.ts";

export { isProjectMentionContext };

export function colorProjectMentions(
    line: string,
    ctx: ExtensionContext,
    trigger: string,
    knownNames: ReadonlySet<string>,
): string {
    if (!line.includes(trigger)) return line;
    if (knownNames.size === 0) return line;

    return line.replace(
        projectMentionPattern(trigger),
        (
            match: string,
            leading: string,
            quotedName: string | undefined,
            unquotedName: string | undefined,
        ) => {
            const parsed = parseProjectMentionName(quotedName, unquotedName, knownNames);
            if (parsed === undefined) return match;

            const mentionEnd = match.length - parsed.suffix.length;
            const mentionText = match.slice(leading.length, mentionEnd);
            return `${leading}${ctx.ui.theme.fg("accent", mentionText)}${parsed.suffix}`;
        },
    );
}

const ANSI_ESCAPE_PATTERN = new RegExp(
    `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
    "g",
);

function stripAnsi(value: string): string {
    return value.replace(ANSI_ESCAPE_PATTERN, "");
}

export function autocompleteStartIndex(renderedLines: string[]): number {
    for (let index = renderedLines.length - 1; index >= 0; index -= 1) {
        const line = renderedLines[index];
        if (line !== undefined && stripAnsi(line).startsWith("─")) return index + 1;
    }
    return renderedLines.length;
}
