import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { autocompleteStartIndex, colorSkillMentions, isSkillMentionContext } from "./rendering.ts";
import { applyEditorEnhancer } from "./editor-enhancer.ts";
import type { EditorLike } from "./types.ts";

const MENTION_EDITOR_ENHANCER = Symbol.for("zigai.pi-mention-skill.editor-enhancer");

type SkillNameSnapshot = () => ReadonlySet<string>;

function enhanceEditor(
    editor: EditorLike,
    ctx: ExtensionContext,
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
    ctx: ExtensionContext,
    trigger: string,
    getSkillNames: SkillNameSnapshot,
): void {
    if (!ctx.hasUI) return;

    applyEditorEnhancer(ctx, MENTION_EDITOR_ENHANCER, (editor) =>
        enhanceEditor(editor, ctx, trigger, getSkillNames),
    );
}
