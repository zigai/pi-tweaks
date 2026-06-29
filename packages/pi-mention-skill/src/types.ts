import type { ExtensionContext, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export type SkillCommand = SlashCommandInfo & {
    name: `skill:${string}`;
    description: string;
};

export type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export type EditorLike = {
    getText(): string;
    handleInput(data: string): void;
    render(width: number): string[];
    isShowingAutocomplete?(): boolean;
    tryTriggerAutocomplete?(explicitTab?: boolean): void;
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
