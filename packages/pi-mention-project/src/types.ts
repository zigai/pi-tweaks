import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export type EditorLike = {
    getText(): string;
    handleInput(data: string): void;
    render(width: number): string[];
    isShowingAutocomplete?(): boolean;
    tryTriggerAutocomplete?(explicitTab?: boolean): void;
};

export type ProjectDirectory = {
    name: string;
    path: string;
    root: string;
};

export type MentionProjectSettings = {
    trigger: string;
    roots: string[];
    gitReposOnly: boolean;
    includeDotFolders: boolean;
};
