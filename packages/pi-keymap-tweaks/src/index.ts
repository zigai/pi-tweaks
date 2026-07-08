import {
    AgentSession,
    CustomEditor,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

type PromptOptions = Parameters<AgentSession["prompt"]>[1];
type PromptResult = ReturnType<AgentSession["prompt"]>;
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

const SWAP_MARKER = Symbol.for("pi-ui-tweaks.swap-submit-and-follow-up");
const TERMINAL_ENTER_MARKER = Symbol.for("pi-ui-tweaks.terminal-lf-enter-submit");
const KEYMAP_FACTORY_BASE = Symbol.for("zigai.pi-keymap-tweaks.editor-factory-base");

type PatchableAgentSessionPrototype = AgentSession & {
    [SWAP_MARKER]?: true;
};

type PatchableEditorPrototype = Editor & {
    [TERMINAL_ENTER_MARKER]?: true;
};

type EditorInternals = {
    state: { lines: string[]; cursorLine: number; cursorCol: number };
    historyIndex?: unknown;
    lastAction: unknown;
    setCursorCol(column: number): void;
};

type EditorLike = CustomEditor & {
    handleInput(data: string): void;
    requestRenderNow?: () => void;
};

type WrappedEditorFactory = EditorFactory & {
    [KEYMAP_FACTORY_BASE]?: EditorFactory | undefined;
};

function swappedStreamingBehavior(options: PromptOptions): PromptOptions {
    if (options?.streamingBehavior === "steer") {
        return { ...options, streamingBehavior: "followUp" };
    }

    if (options?.streamingBehavior === "followUp") {
        return { ...options, streamingBehavior: "steer" };
    }

    return options;
}

function isNonEmpty(value: string | undefined): boolean {
    return value !== undefined && value.length > 0;
}

function shouldNormalizeLfEnter(): boolean {
    return (
        isNonEmpty(process.env.SSH_CONNECTION) ||
        isNonEmpty(process.env.SSH_CLIENT) ||
        isNonEmpty(process.env.SSH_TTY) ||
        isNonEmpty(process.env.TMUX)
    );
}

function patchStreamingBehaviorSwap(): void {
    const prototype = AgentSession.prototype as PatchableAgentSessionPrototype;
    if (prototype[SWAP_MARKER] === true) return;

    const originalPrompt = Reflect.get(AgentSession.prototype, "prompt") as
        | AgentSession["prompt"]
        | undefined;
    if (typeof originalPrompt !== "function") return;

    AgentSession.prototype.prompt = function promptWithSwappedStreamingBehavior(
        this: AgentSession,
        text: string,
        options?: PromptOptions,
    ): PromptResult {
        return originalPrompt.call(this, text, swappedStreamingBehavior(options));
    };

    prototype[SWAP_MARKER] = true;
}

function patchTerminalLfEnterSubmit(): void {
    if (!shouldNormalizeLfEnter()) return;

    const prototype = Editor.prototype as PatchableEditorPrototype;
    if (prototype[TERMINAL_ENTER_MARKER] === true) return;

    const originalHandleInput = Reflect.get(Editor.prototype, "handleInput") as
        | Editor["handleInput"]
        | undefined;
    if (typeof originalHandleInput !== "function") return;

    Editor.prototype.handleInput = function handleSshLfEnterAsSubmit(
        this: Editor,
        data: string,
    ): void {
        let normalizedData = data;
        if (data === "\n") {
            normalizedData = "\r";
        }
        originalHandleInput.call(this, normalizedData);
    };

    prototype[TERMINAL_ENTER_MARKER] = true;
}

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

function isBrowsingPromptHistory(editor: EditorLike): boolean {
    const self = editor as unknown as EditorInternals;
    return typeof self.historyIndex === "number" && self.historyIndex > -1;
}

function shouldBlockPromptHistoryUp(editor: EditorLike): boolean {
    if (editor.isShowingAutocomplete()) return false;
    if (editor.getText().length === 0) return false;
    if (isBrowsingPromptHistory(editor)) return false;

    const cursor = editor.getCursor();
    return cursor.line === 0 && cursor.col === 0;
}

function enhanceEditor(
    editor: EditorLike,
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    requestRender: () => void,
): EditorLike {
    editor.requestRenderNow ??= requestRender;

    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        if (editor.onExtensionShortcut?.(data) === true) return;

        if (
            keybindings.matches(data, "tui.editor.cursorUp") &&
            shouldBlockPromptHistoryUp(editor)
        ) {
            editor.requestRenderNow?.();
            return;
        }

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

    return editor;
}

export function applySubmitModeKeymap(): void {
    patchStreamingBehaviorSwap();
    patchTerminalLfEnterSubmit();
}

export function applyKeymapEditor(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    const existing = ctx.ui.getEditorComponent() as WrappedEditorFactory | undefined;
    const baseFactory = existing?.[KEYMAP_FACTORY_BASE] ?? existing;
    const factory = ((tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as EditorLike;
        return enhanceEditor(editor, keybindings, () => tui.requestRender());
    }) as WrappedEditorFactory;
    factory[KEYMAP_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}

export default function piKeymap(pi: ExtensionAPI): void {
    applySubmitModeKeymap();

    pi.on("session_start", async (_event, ctx) => {
        applyKeymapEditor(ctx);
    });
}
