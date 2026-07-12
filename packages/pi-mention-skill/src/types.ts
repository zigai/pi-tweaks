import type { ExtensionContext, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export type SkillCommand = SlashCommandInfo & {
    name: `skill:${string}`;
    description: string;
};

export type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export type EditorLike = ReturnType<EditorFactory>;

export type EditorEnhancerContext = {
    hasUI: boolean;
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "setEditorComponent"> & {
        theme: Pick<ExtensionContext["ui"]["theme"], "fg">;
    };
};

export type SkillExpansion = {
    name: string;
    location: string;
    body: string;
    baseDir: string;
};

export type MentionSkillSettings = {
    trigger: string;
    hideSlashSkills: boolean;
    completionSuffix: string;
};
