import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    buildHistoryList,
    collectUserPromptsFromEntries,
    historiesMatch,
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

let loadCounter = 0;

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

export function applyPromptHistoryEditor(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    const currentEntries = ctx.sessionManager.getBranch();
    const currentPrompts = collectUserPromptsFromEntries(currentEntries);
    const immediateHistory = buildHistoryList(currentPrompts, []);

    const currentLoad = ++loadCounter;
    const initialText = ctx.ui.getEditorText();
    setEditor(ctx, immediateHistory);

    void (async () => {
        const previousPrompts = await loadPromptHistoryForCwd(ctx.cwd, sessionFile ?? undefined);
        if (currentLoad !== loadCounter) return;
        if (ctx.ui.getEditorText() !== initialText) return;
        const history = buildHistoryList(currentPrompts, previousPrompts);
        if (historiesMatch(history, immediateHistory)) return;
        setEditor(ctx, history);
    })();
}
