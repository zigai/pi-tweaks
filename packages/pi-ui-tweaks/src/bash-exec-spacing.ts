import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getUiTweaksPatchState } from "./patch-state.ts";

const BASH_EXEC_SPACING_FACTORY_BASE = Symbol.for(
    "zigai.pi-ui-tweaks.bash-exec-spacing-editor-factory-base",
);

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

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

type WrappedEditorFactory = EditorFactory & {
    [BASH_EXEC_SPACING_FACTORY_BASE]?: EditorFactory | undefined;
};

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

    const existing = ctx.ui.getEditorComponent() as WrappedEditorFactory | undefined;
    const baseFactory = existing?.[BASH_EXEC_SPACING_FACTORY_BASE] ?? existing;
    const factory = ((tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as EditorLike;
        return enhanceEditor(editor, () => tui.requestRender());
    }) as WrappedEditorFactory;
    factory[BASH_EXEC_SPACING_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}
