import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerEditorEnhancer, type EditorEnhancerHandle } from "@zigai/pi-extension-internals";

import {
    autocompleteStartIndex,
    colorProjectMentions,
    isProjectMentionContext,
} from "./rendering.ts";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type EditorLike = ReturnType<EditorFactory>;

export type MentionProjectEditorContext = Pick<ExtensionContext, "hasUI"> & {
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "setEditorComponent"> & {
        theme: Pick<ExtensionContext["ui"]["theme"], "fg">;
    };
};

const MENTION_EDITOR_ENHANCER = Symbol.for("zigai.pi-mention-project.editor-enhancer");

type ProjectNameSnapshot = () => ReadonlySet<string>;

type AutocompleteVisibility = {
    isShowingAutocomplete(): boolean;
};

type AutocompleteTrigger = {
    tryTriggerAutocomplete(): void;
};

function hasAutocompleteVisibility(
    editor: EditorLike,
): editor is EditorLike & AutocompleteVisibility {
    return "isShowingAutocomplete" in editor && typeof editor.isShowingAutocomplete === "function";
}

function hasAutocompleteTrigger(editor: EditorLike): editor is EditorLike & AutocompleteTrigger {
    return (
        "tryTriggerAutocomplete" in editor && typeof editor.tryTriggerAutocomplete === "function"
    );
}

function isShowingAutocomplete(editor: EditorLike): boolean {
    return hasAutocompleteVisibility(editor) && editor.isShowingAutocomplete() === true;
}

function tryTriggerAutocomplete(editor: EditorLike): void {
    if (hasAutocompleteTrigger(editor)) editor.tryTriggerAutocomplete();
}

function shouldReactToInput(data: string, trigger: string): boolean {
    if (data === trigger) return true;
    if (data.length !== 1) return false;
    return !/\s/.test(data);
}

function enhanceEditor(
    editor: EditorLike,
    ctx: MentionProjectEditorContext,
    trigger: string,
    getProjectNames: ProjectNameSnapshot,
): EditorLike {
    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        originalHandleInput(data);

        if (!shouldReactToInput(data, trigger)) return;

        const text = editor.getText();
        const lines = text.split("\n");
        const lastLine = lines[lines.length - 1];
        let currentLine = "";
        if (lastLine !== undefined) {
            currentLine = lastLine;
        }
        if (!isProjectMentionContext(currentLine, trigger)) return;
        if (isShowingAutocomplete(editor)) return;
        tryTriggerAutocomplete(editor);
    };

    const originalRender = editor.render.bind(editor);
    editor.render = (width: number) => {
        const renderedLines = originalRender(width);
        let colorThrough = renderedLines.length;
        if (isShowingAutocomplete(editor)) {
            colorThrough = autocompleteStartIndex(renderedLines);
        }
        let projectNames: ReadonlySet<string> | undefined;
        return renderedLines.map((line, index) => {
            if (index >= colorThrough || !line.includes(trigger)) return line;
            projectNames ??= getProjectNames();
            return colorProjectMentions(line, ctx, trigger, projectNames);
        });
    };

    return editor;
}

export function applyMentionProjectEditor(
    ctx: MentionProjectEditorContext,
    trigger: string,
    getProjectNames: ProjectNameSnapshot,
): EditorEnhancerHandle<Parameters<EditorFactory>, EditorLike> {
    return registerEditorEnhancer(
        ctx,
        MENTION_EDITOR_ENHANCER,
        (tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings),
        (editor) => enhanceEditor(editor, ctx, trigger, getProjectNames),
    );
}
