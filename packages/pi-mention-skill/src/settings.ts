import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import { loadPiExtensionSettingsSync } from "@zigai/pi-extension-settings/pi";
import { Type } from "typebox";

import type { MentionSkillSettings } from "./types.ts";

export const DEFAULT_MENTION_TRIGGER = "$";
export const DEFAULT_COMPLETION_SUFFIX = " ";

export const mentionSkillSettingsDefinition = defineExtensionSettings({
    id: "pi-mention-skill",
    title: "Pi Mention Skill",
    description: "Settings for skill mentions and slash-skill visibility.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-mention-skill/config.schema.json",
    schema: Type.Object(
        {
            trigger: Type.String({
                minLength: 1,
                maxLength: 1,
                pattern: "^[^/\\s]$",
                default: DEFAULT_MENTION_TRIGGER,
                description: "Single character that starts a skill mention.",
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
});

export default mentionSkillSettingsDefinition;

export type MentionSkillSettingsContext = Pick<ExtensionContext, "cwd"> & {
    isProjectTrusted?: () => boolean;
};

/** Load validated global and trusted-project mention settings. */
export function loadMentionSkillSettings(ctx: MentionSkillSettingsContext): MentionSkillSettings {
    const loaded = loadPiExtensionSettingsSync(
        mentionSkillSettingsDefinition,
        {
            cwd: ctx.cwd,
            isProjectTrusted: () => ctx.isProjectTrusted?.() ?? true,
        },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );

    return {
        trigger: loaded.settings.trigger,
        hideSlashSkills: loaded.settings.hideSlashSkills,
        completionSuffix: loaded.settings.completionSuffix,
    };
}
