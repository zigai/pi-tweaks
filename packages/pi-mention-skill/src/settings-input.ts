import { Type } from "typebox";

export type MentionSkillSettings = {
    trigger: string;
    hideSlashSkills: boolean;
    completionSuffix: string;
};

export const DEFAULT_MENTION_TRIGGER = "$";
export const DEFAULT_COMPLETION_SUFFIX = " ";

export const extensionSettingsInput = {
    id: "pi-mention-skill",
    title: "Pi Mention Skill",
    description: "Settings for skill mentions and slash-skill visibility.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-mention-skill/config.schema.json",
    schema: Type.Object(
        {
            trigger: Type.String({
                minLength: 1,
                pattern: "^[^/\\s]+$",
                default: DEFAULT_MENTION_TRIGGER,
                description:
                    "One or more non-whitespace, non-slash characters that start a skill mention.",
            }),
            hideSlashSkills: Type.Boolean({
                default: true,
                description: "Hide skill commands from slash-command completion.",
            }),
            completionSuffix: Type.String({
                default: DEFAULT_COMPLETION_SUFFIX,
                description: "Text inserted after a completed skill mention.",
            }),
        },
        { additionalProperties: false },
    ),
};

export default extensionSettingsInput;
