import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { registerEditorEnhancer, type EditorEnhancerHandle } from "@zigai/pi-extension-internals";

import { collectUserPromptsFromEntries } from "./prompt-history.ts";

const PROMPT_HISTORY_EDITOR_ENHANCER = Symbol.for("zigai.pi-prompt-history.editor-enhancer");

type EditorArgs = [tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager];
type EditorLike = EditorComponent;

export type PromptHistoryEditorContext = Pick<ExtensionContext, "hasUI"> & {
    sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch">;
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "setEditorComponent">;
};

function isEditorComponent(value: unknown): value is EditorComponent {
    if (typeof value !== "object" || value === null) return false;

    return (
        typeof Reflect.get(value, "render") === "function" &&
        typeof Reflect.get(value, "invalidate") === "function" &&
        typeof Reflect.get(value, "getText") === "function" &&
        typeof Reflect.get(value, "setText") === "function" &&
        typeof Reflect.get(value, "handleInput") === "function"
    );
}

function getFocusedEditor(tui: TUI): EditorLike | undefined {
    const getFocusedComponent: unknown = Reflect.get(tui, "getFocusedComponent") as unknown;
    if (typeof getFocusedComponent !== "function") return undefined;

    const focused: unknown = Reflect.apply(getFocusedComponent, tui, []) as unknown;
    if (!isEditorComponent(focused)) return undefined;
    return focused;
}

function enhanceEditor(editor: EditorLike, history: string[]): EditorLike {
    for (const prompt of history) {
        editor.addToHistory?.(prompt);
    }
    return editor;
}

function createFocusedEditor(tui: TUI): EditorLike {
    const editor = getFocusedEditor(tui);
    if (editor === undefined) {
        throw new Error("Cannot preserve the active editor while loading prompt history");
    }
    return editor;
}

/** Installs an editor preloaded with prompts from the current session branch. */
export function applyPromptHistoryEditor(
    ctx: PromptHistoryEditorContext,
): EditorEnhancerHandle<EditorArgs, EditorLike> {
    if (!ctx.hasUI) {
        return registerEditorEnhancer(
            ctx,
            PROMPT_HISTORY_EDITOR_ENHANCER,
            (tui) => createFocusedEditor(tui),
            (editor) => editor,
        );
    }
    const currentEntries = ctx.sessionManager.getBranch();
    const currentPrompts = collectUserPromptsFromEntries(currentEntries);
    return registerEditorEnhancer(
        ctx,
        PROMPT_HISTORY_EDITOR_ENHANCER,
        (tui) => createFocusedEditor(tui),
        (editor) => enhanceEditor(editor, currentPrompts),
    );
}
