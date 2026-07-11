import {
    CustomEditor,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getCurrentMode, getModeBorderColor, setRequestEditorRender } from "./mode-state.ts";

const MODE_FACTORY_BASE = Symbol.for("zigai.pi-model-modes.editor-factory-base");

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

type EditorLike = CustomEditor & {
    borderColor: (text: string) => string;
    getText(): string;
};

type WrappedEditorFactory = EditorFactory & {
    [MODE_FACTORY_BASE]?: EditorFactory | undefined;
};

function enhanceEditor(
    editor: EditorLike,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    requestRender: () => void,
): EditorLike {
    const defaultBorderColor = editor.borderColor;

    const borderColor = (text: string) => {
        const isBashMode = editor.getText().trimStart().startsWith("!");
        if (isBashMode) {
            return ctx.ui.theme.getBashModeBorderColor()(text);
        }
        return getModeBorderColor(ctx, pi, getCurrentMode(), defaultBorderColor)(text);
    };

    Object.defineProperty(editor, "borderColor", {
        get: () => borderColor,
        set: () => {},
        configurable: true,
        enumerable: true,
    });

    setRequestEditorRender(requestRender);
    return editor;
}

export function applyModeEditor(pi: ExtensionAPI, ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    const existing = ctx.ui.getEditorComponent() as WrappedEditorFactory | undefined;
    const baseFactory = existing?.[MODE_FACTORY_BASE] ?? existing;
    const factory = ((tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as EditorLike;
        return enhanceEditor(editor, pi, ctx, () => tui.requestRender());
    }) as WrappedEditorFactory;
    factory[MODE_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}
