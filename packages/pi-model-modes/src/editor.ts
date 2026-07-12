import {
    CustomEditor,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getCurrentMode, getModeBorderColor, setRequestEditorRender } from "./mode-state.ts";

const MODE_FACTORY_BASE = Symbol.for("zigai.pi-model-modes.editor-factory-base");

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

type EditorLike = ReturnType<EditorFactory> & {
    borderColor: (text: string) => string;
    getText(): string;
};

type WrappedEditorFactory = EditorFactory & {
    [MODE_FACTORY_BASE]?: EditorFactory | undefined;
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function isEditorLike(value: ReturnType<EditorFactory>): value is EditorLike {
    return (
        typeof getUnknownProperty(value, "borderColor") === "function" &&
        typeof getUnknownProperty(value, "getText") === "function"
    );
}

function isWrappedEditorFactory(value: EditorFactory | undefined): value is WrappedEditorFactory {
    return value !== undefined && Reflect.has(value, MODE_FACTORY_BASE);
}

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

    const configuredFactory = ctx.ui.getEditorComponent();
    let existing: WrappedEditorFactory | undefined;
    if (isWrappedEditorFactory(configuredFactory)) {
        existing = configuredFactory;
    }
    const baseFactory = existing?.[MODE_FACTORY_BASE] ?? configuredFactory;
    const factory: WrappedEditorFactory = (tui, theme, keybindings) => {
        const editor =
            baseFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
        if (!isEditorLike(editor)) return editor;
        return enhanceEditor(editor, pi, ctx, () => tui.requestRender());
    };
    factory[MODE_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}
