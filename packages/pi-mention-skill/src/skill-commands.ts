import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { SkillCommand } from "./types.ts";

const SKILL_COMMAND_PREFIX = "skill:";

export function stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;

    const end = content.indexOf("\n---", 3);
    if (end === -1) return content;

    const afterMarker = end + "\n---".length;
    if (content[afterMarker] === "\r" && content[afterMarker + 1] === "\n") {
        return content.slice(afterMarker + 2);
    }
    if (content[afterMarker] === "\n") {
        return content.slice(afterMarker + 1);
    }
    return content.slice(afterMarker);
}

export type SkillCommandSource = {
    getCachedSkillNames(): ReadonlySet<string>;
    getSkillCommands(): SkillCommand[];
    refresh(): SkillCommand[];
};

export function getSkillCommands(pi: ExtensionAPI): SkillCommand[] {
    return pi.getCommands().filter((command): command is SkillCommand => {
        return command.source === "skill" && command.name.startsWith(SKILL_COMMAND_PREFIX);
    });
}

export function skillName(command: SkillCommand): string {
    return command.name.slice(SKILL_COMMAND_PREFIX.length);
}

export function skillNameSet(commands: ReadonlyArray<SkillCommand>): Set<string> {
    return new Set(commands.map(skillName));
}

export function createSkillCommandSource(pi: ExtensionAPI): SkillCommandSource {
    let cachedCommands: SkillCommand[] = [];
    let cachedSkillNames: ReadonlySet<string> = new Set();

    const refresh = (): SkillCommand[] => {
        cachedCommands = getSkillCommands(pi);
        cachedSkillNames = skillNameSet(cachedCommands);
        return [...cachedCommands];
    };

    return {
        getCachedSkillNames() {
            return cachedSkillNames;
        },
        getSkillCommands() {
            return refresh();
        },
        refresh,
    };
}
