import {
    getAgentDir,
    SettingsManager,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { MentionSkillSettings } from "./types.ts";

export const DEFAULT_MENTION_TRIGGER = "$";
export const DEFAULT_COMPLETION_SUFFIX = " ";
const TRIGGER_SETTINGS_KEY = "mentionSkillTrigger";
const HIDE_SLASH_SKILLS_SETTINGS_KEY = "mentionSkillHideSlashSkills";
const COMPLETION_SUFFIX_SETTINGS_KEY = "mentionSkillCompletionSuffix";

const MentionTriggerSchema = Type.String({ minLength: 1, maxLength: 1, pattern: "^[^/\\s]$" });
const HideSlashSkillsSchema = Type.Boolean();
const CompletionSuffixSchema = Type.String();

type ProjectTrustContext = ExtensionContext & {
    isProjectTrusted?: () => boolean;
};

function isProjectTrusted(ctx: ExtensionContext): boolean {
    return (ctx as ProjectTrustContext).isProjectTrusted?.() ?? true;
}

function parseOptionalString(schema: TSchema, value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (!Value.Check(schema, value)) return undefined;
    const parsed: unknown = Value.Parse(schema, value);
    if (typeof parsed === "string") return parsed;
    return undefined;
}

function parseOptionalBoolean(schema: TSchema, value: unknown): boolean | undefined {
    if (value === undefined) return undefined;
    if (!Value.Check(schema, value)) return undefined;
    const parsed: unknown = Value.Parse(schema, value);
    if (typeof parsed === "boolean") return parsed;
    return undefined;
}

function applyMentionSkillSettings(
    settings: Record<string, unknown>,
    target: MentionSkillSettings,
): void {
    const trigger = parseOptionalString(MentionTriggerSchema, settings[TRIGGER_SETTINGS_KEY]);
    if (trigger !== undefined) {
        target.trigger = trigger;
    }

    const hideSlashSkills = parseOptionalBoolean(
        HideSlashSkillsSchema,
        settings[HIDE_SLASH_SKILLS_SETTINGS_KEY],
    );
    if (hideSlashSkills !== undefined) {
        target.hideSlashSkills = hideSlashSkills;
    }

    const completionSuffix = parseOptionalString(
        CompletionSuffixSchema,
        settings[COMPLETION_SUFFIX_SETTINGS_KEY],
    );
    if (completionSuffix !== undefined) {
        target.completionSuffix = completionSuffix;
    }
}

export function configuredMentionSkillSettings(ctx: ExtensionContext): MentionSkillSettings {
    const loaded: MentionSkillSettings = {
        trigger: DEFAULT_MENTION_TRIGGER,
        hideSlashSkills: true,
        completionSuffix: DEFAULT_COMPLETION_SUFFIX,
    };

    const manager = SettingsManager.create(ctx.cwd, getAgentDir(), {
        projectTrusted: isProjectTrusted(ctx),
    });
    applyMentionSkillSettings(manager.getGlobalSettings() as Record<string, unknown>, loaded);
    applyMentionSkillSettings(manager.getProjectSettings() as Record<string, unknown>, loaded);
    return loaded;
}
