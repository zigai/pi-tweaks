import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getSkillCommands, skillName } from "./skill-commands.ts";
import { escapeRegExp } from "./util.ts";

export function isSkillMentionContext(text: string, trigger: string): boolean {
    return new RegExp(`(?:^|\\s)${escapeRegExp(trigger)}[a-z0-9-]*$`).test(text);
}

export function colorSkillMentions(
    line: string,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    trigger: string,
    cachedSkillNames?: ReadonlySet<string>,
): string {
    if (!line.includes(trigger)) return line;

    const skillNames = cachedSkillNames ?? new Set(getSkillCommands(pi).map(skillName));
    if (skillNames.size === 0) return line;

    const mentionPattern = new RegExp(`${escapeRegExp(trigger)}([a-z0-9][a-z0-9-]{0,63})`, "g");
    return line.replace(mentionPattern, (match: string, name: string) => {
        if (!skillNames.has(name)) return match;
        return ctx.ui.theme.fg("accent", match);
    });
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
