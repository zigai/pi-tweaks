import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    autocompleteStartIndex,
    colorProjectMentions,
    isProjectMentionContext,
} from "./rendering.ts";
import type { EditorFactory, EditorLike, ProjectDirectory } from "./types.ts";

const MENTION_FACTORY_BASE = Symbol.for("zigai.pi-mention-project.editor-factory-base");

type WrappedEditorFactory = EditorFactory & {
    [MENTION_FACTORY_BASE]?: EditorFactory | undefined;
};

type ProjectSnapshot = () => ProjectDirectory[];

function shouldReactToInput(data: string, trigger: string): boolean {
    if (data === trigger) return true;
    if (data.length !== 1) return false;
    return !/\s/.test(data);
}

function enhanceEditor(
    editor: EditorLike,
    ctx: ExtensionContext,
    trigger: string,
    getProjects: ProjectSnapshot,
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
        if (editor.isShowingAutocomplete?.() === true) return;
        editor.tryTriggerAutocomplete?.();
    };

    const originalRender = editor.render.bind(editor);
    editor.render = (width: number) => {
        const renderedLines = originalRender(width);
        let colorThrough = renderedLines.length;
        if (editor.isShowingAutocomplete?.() === true) {
            colorThrough = autocompleteStartIndex(renderedLines);
        }
        return renderedLines.map((line, index) => {
            if (index >= colorThrough) return line;
            return colorProjectMentions(line, ctx, trigger, getProjects());
        });
    };

    return editor;
}

export function applyMentionProjectEditor(
    ctx: ExtensionContext,
    trigger: string,
    getProjects: ProjectSnapshot,
): void {
    if (!ctx.hasUI) return;

    const existing = ctx.ui.getEditorComponent() as WrappedEditorFactory | undefined;
    const baseFactory = existing?.[MENTION_FACTORY_BASE] ?? existing;
    const factory = ((tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as unknown as EditorLike;
        return enhanceEditor(editor, ctx, trigger, getProjects);
    }) as WrappedEditorFactory;
    factory[MENTION_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}
