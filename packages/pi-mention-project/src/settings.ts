import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import { loadPiExtensionSettingsSync } from "@zigai/pi-extension-settings/pi";
import { Type } from "typebox";

import type { MentionProjectSettings } from "./types.ts";

export const DEFAULT_MENTION_TRIGGER = "#";
export const DEFAULT_COMPLETION_SUFFIX = " ";
export const INCLUDE_NON_GIT_FLAG = "mention-project-include-non-git";
export const INCLUDE_DOT_FOLDERS_FLAG = "mention-project-include-dot-folders";

export const mentionProjectSettingsDefinition = defineExtensionSettings({
    id: "pi-mention-project",
    title: "Pi Mention Project",
    description: "Settings for project mentions and project discovery.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-mention-project/config.schema.json",
    schema: Type.Object(
        {
            trigger: Type.String({
                minLength: 1,
                maxLength: 1,
                pattern: "^[^/\\s]$",
                default: DEFAULT_MENTION_TRIGGER,
                description: "Single character that starts a project mention.",
            }),
            roots: Type.Union(
                [Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }))],
                {
                    default: [],
                    description: "Project root directory or directories searched for projects.",
                },
            ),
            gitReposOnly: Type.Boolean({
                default: true,
                description: "Include only directories containing Git repositories.",
            }),
            includeDotFolders: Type.Boolean({
                default: false,
                description: "Include project directories whose names start with a dot.",
            }),
            completionSuffix: Type.String({
                default: DEFAULT_COMPLETION_SUFFIX,
                description: "Text inserted after a completed project mention.",
            }),
        },
        { additionalProperties: false },
    ),
});

export default mentionProjectSettingsDefinition;

export type MentionProjectSettingsContext = Pick<ExtensionContext, "cwd"> & {
    isProjectTrusted?: () => boolean;
};

/** Load validated global and trusted-project project-mention settings. */
export function loadMentionProjectSettings(
    ctx: MentionProjectSettingsContext,
): MentionProjectSettings {
    const loaded = loadPiExtensionSettingsSync(
        mentionProjectSettingsDefinition,
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
    let roots: string[];
    if (Array.isArray(loaded.settings.roots)) {
        roots = [...loaded.settings.roots];
    } else {
        roots = [loaded.settings.roots];
    }

    return {
        trigger: loaded.settings.trigger,
        roots,
        gitReposOnly: loaded.settings.gitReposOnly,
        includeDotFolders: loaded.settings.includeDotFolders,
        completionSuffix: loaded.settings.completionSuffix,
    };
}

export function applyMentionProjectCliFlags(
    settings: MentionProjectSettings,
    flags: { includeNonGit: unknown; includeDotFolders: unknown },
): MentionProjectSettings {
    const loaded = { ...settings };
    if (flags.includeNonGit === true) loaded.gitReposOnly = false;
    if (flags.includeDotFolders === true) loaded.includeDotFolders = true;
    return loaded;
}
