import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    buildHistoryList,
    collectUserPromptsFromEntries,
    loadPromptHistoryForCwd,
} from "./prompt-history.ts";
import type { PromptEntry } from "./types.ts";

const HISTORY_FACTORY_BASE = Symbol.for("zigai.pi-prompt-history.editor-factory-base");

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

type EditorLike = CustomEditor & {
    addToHistory?: (text: string) => void;
    render(width: number): string[];
};

type WrappedEditorFactory = EditorFactory & {
    [HISTORY_FACTORY_BASE]?: EditorFactory | undefined;
};

function enhanceEditor(editor: EditorLike, history: PromptEntry[]): EditorLike {
    for (const prompt of history) {
        editor.addToHistory?.(prompt.text);
    }
    return editor;
}

function setEditor(ctx: ExtensionContext, history: PromptEntry[]): void {
    const existing = ctx.ui.getEditorComponent() as WrappedEditorFactory | undefined;
    const baseFactory = existing?.[HISTORY_FACTORY_BASE] ?? existing;
    const factory = ((tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as EditorLike;
        return enhanceEditor(editor, history);
    }) as WrappedEditorFactory;
    factory[HISTORY_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}

export type PromptHistoryLoader = (
    cwd: string,
    excludeSessionFile?: string,
) => Promise<PromptEntry[]>;

/** Loads prompt history before installing the session editor exactly once. */
export async function applyPromptHistoryEditor(
    ctx: ExtensionContext,
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
