import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    buildHistoryList,
    collectUserPromptsFromEntries,
    loadPromptHistoryForCwd,
} from "./prompt-history.ts";
import type { PromptEntry } from "./types.ts";

const HISTORY_FACTORY_BASE = Symbol.for("zigai.pi-prompt-history.editor-factory-base");

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

type EditorLike = ReturnType<EditorFactory>;

type WrappedEditorFactory = EditorFactory & {
    [HISTORY_FACTORY_BASE]?: EditorFactory | undefined;
};

export type PromptHistoryEditorContext = Pick<ExtensionContext, "cwd" | "hasUI"> & {
    sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch" | "getSessionFile">;
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "getEditorText" | "setEditorComponent">;
};

function isWrappedEditorFactory(value: EditorFactory | undefined): value is WrappedEditorFactory {
    return value !== undefined && Reflect.has(value, HISTORY_FACTORY_BASE);
}

function enhanceEditor(editor: EditorLike, history: PromptEntry[]): EditorLike {
    for (const prompt of history) {
        editor.addToHistory?.(prompt.text);
    }
    return editor;
}

function setEditor(ctx: PromptHistoryEditorContext, history: PromptEntry[]): void {
    const configuredFactory = ctx.ui.getEditorComponent();
    let existing: WrappedEditorFactory | undefined;
    if (isWrappedEditorFactory(configuredFactory)) {
        existing = configuredFactory;
    }
    const baseFactory = existing?.[HISTORY_FACTORY_BASE] ?? configuredFactory;
    const factory: WrappedEditorFactory = (tui, theme, keybindings) => {
        const editor: EditorLike =
            baseFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
        return enhanceEditor(editor, history);
    };
    factory[HISTORY_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}

export type PromptHistoryLoader = (
    cwd: string,
    excludeSessionFile?: string,
) => Promise<PromptEntry[]>;

/** Loads prompt history before installing the session editor exactly once. */
export async function applyPromptHistoryEditor(
    ctx: PromptHistoryEditorContext,
    loadHistory: PromptHistoryLoader = loadPromptHistoryForCwd,
): Promise<void> {
    if (!ctx.hasUI) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    const currentEntries = ctx.sessionManager.getBranch();
    const currentPrompts = collectUserPromptsFromEntries(currentEntries);
    const initialText = ctx.ui.getEditorText();
    const previousPrompts = await loadHistory(ctx.cwd, sessionFile ?? undefined);
    if (ctx.ui.getEditorText() !== initialText) return;

    setEditor(ctx, buildHistoryList(currentPrompts, previousPrompts));
}
