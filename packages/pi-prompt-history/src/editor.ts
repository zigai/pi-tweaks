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

type EditorInternals = {
    state: { lines: string[]; cursorLine: number; cursorCol: number };
    lastAction: unknown;
    setCursorCol(column: number): void;
};

type EditorLike = CustomEditor & {
    addToHistory?: (text: string) => void;
    render(width: number): string[];
    handleInput(data: string): void;
    requestRenderNow?: () => void;
};

type WrappedEditorFactory = EditorFactory & {
    [HISTORY_FACTORY_BASE]?: EditorFactory | undefined;
};

let loadCounter = 0;

function moveToCodexLineStart(editor: EditorLike): void {
    const self = editor as unknown as EditorInternals;
    const state = self.state;

    self.lastAction = null;
    if (state.cursorCol === 0 && state.cursorLine > 0) {
        state.cursorLine -= 1;
    }
    self.setCursorCol(0);
    editor.requestRenderNow?.();
}

function moveToCodexLineEnd(editor: EditorLike): void {
    const self = editor as unknown as EditorInternals;
    const state = self.state;
    const currentLine = state.lines[state.cursorLine] || "";

    self.lastAction = null;
    if (state.cursorCol >= currentLine.length && state.cursorLine < state.lines.length - 1) {
        state.cursorLine += 1;
        const nextLine = state.lines[state.cursorLine] || "";
        self.setCursorCol(nextLine.length);
        editor.requestRenderNow?.();
        return;
    }
    self.setCursorCol(currentLine.length);
    editor.requestRenderNow?.();
}

function enhanceEditor(
    editor: EditorLike,
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    history: PromptEntry[],
    requestRender: () => void,
): EditorLike {
    editor.requestRenderNow ??= requestRender;

    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        if (editor.onExtensionShortcut?.(data) === true) return;

        if (keybindings.matches(data, "tui.editor.cursorLineStart")) {
            moveToCodexLineStart(editor);
            return;
        }

        if (keybindings.matches(data, "tui.editor.cursorLineEnd")) {
            moveToCodexLineEnd(editor);
            return;
        }

        originalHandleInput(data);
    };

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
        return enhanceEditor(editor, keybindings, history, () => tui.requestRender());
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
