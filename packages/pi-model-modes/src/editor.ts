import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerEditorEnhancer } from "@zigai/pi-extension-internals";

import type { ModeController } from "./mode-controller.ts";

const MODE_EDITOR_ENHANCER = Symbol.for("zigai.pi-model-modes.editor-enhancer");

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type EditorLike = ReturnType<EditorFactory> & {
    borderColor: (text: string) => string;
    getText(): string;
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

export function applyModeEditor(
    controller: ModeController,
    ctx: ExtensionContext,
): { dispose(): void } | undefined {
    if (!ctx.hasUI) return undefined;
    return registerEditorEnhancer(
        ctx,
        MODE_EDITOR_ENHANCER,
        (tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings),
        (editor, tui) => {
            if (!isEditorLike(editor)) return editor;
            const defaultBorderColor = editor.borderColor;
            const borderColor = (text: string): string => {
                if (editor.getText().trimStart().startsWith("!")) {
                    return ctx.ui.theme.getBashModeBorderColor()(text);
                }
                return controller.getModeBorderColor(
                    ctx,
                    controller.currentMode,
                    defaultBorderColor,
                )(text);
            };
            Object.defineProperty(editor, "borderColor", {
                get: () => borderColor,
                set: () => {},
                configurable: true,
                enumerable: true,
            });
            controller.setEditorRenderRequest(() => tui.requestRender());
            return editor;
        },
    );
}
