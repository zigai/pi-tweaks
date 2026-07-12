import {
    autocompleteStartIndex,
    colorProjectMentions,
    isProjectMentionContext,
} from "./rendering.ts";
import { applyEditorEnhancer } from "./editor-enhancer.ts";
import type { EditorEnhancerContext, EditorLike } from "./types.ts";

const MENTION_EDITOR_ENHANCER = Symbol.for("zigai.pi-mention-project.editor-enhancer");

type ProjectNameSnapshot = () => ReadonlySet<string>;

function getOptionalEditorMethod(editor: EditorLike, name: string): (() => unknown) | undefined {
    const method: unknown = Reflect.get(editor, name) as unknown;
    if (typeof method !== "function") return undefined;
    return () => Reflect.apply(method, editor, []) as unknown;
}

function isShowingAutocomplete(editor: EditorLike): boolean {
    return getOptionalEditorMethod(editor, "isShowingAutocomplete")?.() === true;
}

function tryTriggerAutocomplete(editor: EditorLike): void {
    getOptionalEditorMethod(editor, "tryTriggerAutocomplete")?.();
}

function shouldReactToInput(data: string, trigger: string): boolean {
    if (data === trigger) return true;
    if (data.length !== 1) return false;
    return !/\s/.test(data);
}

function enhanceEditor(
    editor: EditorLike,
    ctx: EditorEnhancerContext,
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
    ctx: EditorEnhancerContext,
    trigger: string,
    getProjectNames: ProjectNameSnapshot,
): void {
    if (!ctx.hasUI) return;

    applyEditorEnhancer(ctx, MENTION_EDITOR_ENHANCER, (editor) =>
        enhanceEditor(editor, ctx, trigger, getProjectNames),
    );
}
