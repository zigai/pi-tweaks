import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    autocompleteStartIndex,
    colorProjectMentions,
    isProjectMentionContext,
} from "./rendering.ts";
import { applyEditorEnhancer } from "./editor-enhancer.ts";
import type { EditorLike, ProjectDirectory } from "./types.ts";

const MENTION_EDITOR_ENHANCER = Symbol.for("zigai.pi-mention-project.editor-enhancer");

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
        let projects: ProjectDirectory[] | undefined;
        return renderedLines.map((line, index) => {
            if (index >= colorThrough || !line.includes(trigger)) return line;
            projects ??= getProjects();
            return colorProjectMentions(line, ctx, trigger, projects);
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

    applyEditorEnhancer(ctx, MENTION_EDITOR_ENHANCER, (editor) =>
        enhanceEditor(editor, ctx, trigger, getProjects),
    );
}
