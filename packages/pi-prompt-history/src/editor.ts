import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { collectUserPromptsFromEntries } from "./prompt-history.ts";

const HISTORY_FACTORY_BASE = Symbol.for("zigai.pi-prompt-history.editor-factory-base");

type EditorFactory = (
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
) => EditorComponent;

type EditorLike = EditorComponent;

type WrappedEditorFactory = EditorFactory & {
    [HISTORY_FACTORY_BASE]?: EditorFactory | undefined;
};

export type PromptHistoryEditorContext = Pick<ExtensionContext, "hasUI"> & {
    sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch">;
    ui: Pick<ExtensionContext["ui"], "setEditorComponent"> & {
        getEditorComponent?: ExtensionContext["ui"]["getEditorComponent"];
    };
};

function isWrappedEditorFactory(value: EditorFactory | undefined): value is WrappedEditorFactory {
    return value !== undefined && Reflect.has(value, HISTORY_FACTORY_BASE);
}

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

function setEditor(ctx: PromptHistoryEditorContext, history: string[]): void {
    const configuredFactory = ctx.ui.getEditorComponent?.();
    let existing: WrappedEditorFactory | undefined;
    if (isWrappedEditorFactory(configuredFactory)) {
        existing = configuredFactory;
    }
    const baseFactory = existing?.[HISTORY_FACTORY_BASE] ?? configuredFactory;
    const factory: WrappedEditorFactory = (tui, theme, keybindings) => {
        const editor = baseFactory?.(tui, theme, keybindings) ?? getFocusedEditor(tui);
        if (editor === undefined) {
            throw new Error("Cannot preserve the active editor while loading prompt history");
        }
        return enhanceEditor(editor, history);
    };
    factory[HISTORY_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}

/** Installs an editor preloaded with prompts from the current session branch. */
export function applyPromptHistoryEditor(ctx: PromptHistoryEditorContext): void {
    if (!ctx.hasUI) return;

    const currentEntries = ctx.sessionManager.getBranch();
    const currentPrompts = collectUserPromptsFromEntries(currentEntries);
    setEditor(ctx, currentPrompts);
}
