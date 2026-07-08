import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    hasEditorFactoryLayer,
    markEditorFactoryLayer,
    type EditorFactory,
} from "./editor-factory-layers.ts";
import { getUiTweaksPatchState } from "./patch-state.ts";

export type BashExecSpacingEditor = {
    getCursor(): { line: number; col: number };
    getText(): string;
    handleInput(data: string): void;
    insertTextAtCursor?: (text: string) => void;
    onExtensionShortcut?: (data: string) => boolean;
    requestRenderNow?: () => void;
    setText(text: string): void;
};

type EditorLike = CustomEditor & BashExecSpacingEditor;

function requestEditorRender(editor: BashExecSpacingEditor): void {
    editor.requestRenderNow?.();
}

/**
 * Sets whether `!` typed at an empty prompt expands to `! ` for bash mode.
 */
export function setBashExecPromptSpacing(enabled: boolean): void {
    getUiTweaksPatchState().bashExecPromptSpacing = enabled;
}

export function applyBashExecPromptSpacing(editor: BashExecSpacingEditor, data: string): boolean {
    if (!getUiTweaksPatchState().bashExecPromptSpacing) {
        return false;
    }
    if (data !== "!") {
        return false;
    }

    const cursor = editor.getCursor();
    if (cursor.line !== 0) {
        return false;
    }

    const text = editor.getText();
    if (text.length === 0 && cursor.col === 0) {
        if (typeof editor.insertTextAtCursor === "function") {
            editor.insertTextAtCursor("! ");
        } else {
            editor.setText("! ");
        }
        requestEditorRender(editor);
        return true;
    }

    if (text === "!" && cursor.col === 1) {
        editor.setText("!! ");
        requestEditorRender(editor);
        return true;
    }

    if (text === "! " && (cursor.col === 1 || cursor.col === 2)) {
        editor.setText("!! ");
        requestEditorRender(editor);
        return true;
    }

    return false;
}

function enhanceEditor(editor: EditorLike, requestRender: () => void): EditorLike {
    editor.requestRenderNow ??= requestRender;

    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        if (data === "!" && editor.onExtensionShortcut?.(data) === true) {
            return;
        }
        if (applyBashExecPromptSpacing(editor, data)) {
            return;
        }
        originalHandleInput(data);
    };

    return editor;
}

export function applyBashExecSpacingEditor(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
        return;
    }

    const existing = ctx.ui.getEditorComponent();
    if (hasEditorFactoryLayer(existing, "bashExecSpacing")) {
        return;
    }

    const baseFactory = existing;
    const factory: EditorFactory = (tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as EditorLike;
        return enhanceEditor(editor, () => tui.requestRender());
    };
    markEditorFactoryLayer(factory, existing, "bashExecSpacing");

    ctx.ui.setEditorComponent(factory);
}
