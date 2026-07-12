import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export type EditorLike = ReturnType<EditorFactory>;

export type EditorEnhancerContext = {
    hasUI: boolean;
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "setEditorComponent"> & {
        theme: Pick<ExtensionContext["ui"]["theme"], "fg">;
    };
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
    completionSuffix: string;
};
