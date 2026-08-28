import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerEditorEnhancer, type EditorEnhancerHandle } from "@zigai/pi-extension-internals";

import { autocompleteStartIndex, colorSkillMentions, isSkillMentionContext } from "./rendering.ts";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type EditorLike = ReturnType<EditorFactory>;

export type MentionSkillEditorContext = Pick<ExtensionContext, "hasUI"> & {
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "setEditorComponent"> & {
        theme: Pick<ExtensionContext["ui"]["theme"], "fg">;
    };
};

const MENTION_EDITOR_ENHANCER = Symbol.for("zigai.pi-mention-skill.editor-enhancer");

type SkillNameSnapshot = () => ReadonlySet<string>;

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

function enhanceEditor(
    editor: EditorLike,
    ctx: MentionSkillEditorContext,
    trigger: string,
    getSkillNames: SkillNameSnapshot,
): EditorLike {
    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        originalHandleInput(data);

        if (!/^[a-z0-9-]$/i.test(data) && data !== trigger) return;

        const text = editor.getText();
        const lines = text.split("\n");
        const lastLine = lines[lines.length - 1];
        let currentLine = "";
        if (lastLine !== undefined) {
            currentLine = lastLine;
        }
        if (!isSkillMentionContext(currentLine, trigger)) return;
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
        let skillNames: ReadonlySet<string> | undefined;
        return renderedLines.map((line, index) => {
            if (index >= colorThrough || !line.includes(trigger)) return line;
            skillNames ??= getSkillNames();
            return colorSkillMentions(line, ctx, trigger, skillNames);
        });
    };

    return editor;
}

export function applyMentionSkillEditor(
    ctx: MentionSkillEditorContext,
    trigger: string,
    getSkillNames: SkillNameSnapshot,
): EditorEnhancerHandle<Parameters<EditorFactory>, EditorLike> {
    return registerEditorEnhancer(
        ctx,
        MENTION_EDITOR_ENHANCER,
        (tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings),
        (editor) => enhanceEditor(editor, ctx, trigger, getSkillNames),
    );
}
