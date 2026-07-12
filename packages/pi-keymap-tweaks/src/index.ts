import {
    AgentSession,
    copyToClipboard,
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
    pushUndoSnapshot?: () => void;
    exitHistoryBrowsing?: () => void;
};

type ClipboardWriter = (text: string) => Promise<void>;
type Notifier = (message: string, type?: "info" | "warning" | "error") => void;

type KeymapEditorOptions = {
    readonly writeClipboard?: ClipboardWriter;
    readonly notify?: Notifier;
};

type EditorLike = ReturnType<EditorFactory> &
    Pick<
        CustomEditor,
        | "getCursor"
        | "getText"
        | "handleInput"
        | "isShowingAutocomplete"
        | "onChange"
        | "onExtensionShortcut"
    > & {
        handleInput(data: string): void;
        requestRenderNow?: () => void;
    };

type WrappedEditorFactory = EditorFactory & {
    [KEYMAP_FACTORY_BASE]?: EditorFactory | undefined;
};

export type KeymapEditorContext = Pick<ExtensionContext, "hasUI"> & {
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "setEditorComponent">;
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function getEditorInternals(editor: EditorLike): EditorInternals | undefined {
    const state = getUnknownProperty(editor, "state");
    const lines = getUnknownProperty(state, "lines");
    const cursorLine = getUnknownProperty(state, "cursorLine");
    const cursorCol = getUnknownProperty(state, "cursorCol");
    const pushUndoSnapshot = getUnknownProperty(editor, "pushUndoSnapshot");
    const exitHistoryBrowsing = getUnknownProperty(editor, "exitHistoryBrowsing");
    if (
        !Array.isArray(lines) ||
        !lines.every((line) => typeof line === "string") ||
        typeof cursorLine !== "number" ||
        typeof cursorCol !== "number" ||
        typeof getUnknownProperty(editor, "setCursorCol") !== "function" ||
        (pushUndoSnapshot !== undefined && typeof pushUndoSnapshot !== "function") ||
        (exitHistoryBrowsing !== undefined && typeof exitHistoryBrowsing !== "function")
    ) {
        return undefined;
    }
    // SAFETY: The checked editor adapter verifies the complete private state and
    // required mutator before exposing the smallest internals seam used below.
    const internals: unknown = editor;
    return internals as EditorInternals;
}

function isWrappedEditorFactory(value: EditorFactory | undefined): value is WrappedEditorFactory {
    return value !== undefined && Reflect.has(value, KEYMAP_FACTORY_BASE);
}

function isEditorLike(value: ReturnType<EditorFactory>): value is EditorLike {
    const onChange = getUnknownProperty(value, "onChange");
    const onExtensionShortcut = getUnknownProperty(value, "onExtensionShortcut");
    const requestRenderNow = getUnknownProperty(value, "requestRenderNow");
    return (
        typeof getUnknownProperty(value, "handleInput") === "function" &&
        typeof getUnknownProperty(value, "getText") === "function" &&
        typeof getUnknownProperty(value, "getCursor") === "function" &&
        typeof getUnknownProperty(value, "isShowingAutocomplete") === "function" &&
        (onChange === undefined || typeof onChange === "function") &&
        (onExtensionShortcut === undefined || typeof onExtensionShortcut === "function") &&
        (requestRenderNow === undefined || typeof requestRenderNow === "function")
    );
}

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

function getAgentSessionPrompt(): AgentSession["prompt"] | undefined {
    const value: unknown = Object.getOwnPropertyDescriptor(AgentSession.prototype, "prompt")?.value;
    if (typeof value !== "function") return undefined;
    return value as AgentSession["prompt"];
}

function getEditorHandleInput(): Editor["handleInput"] | undefined {
    const value: unknown = Object.getOwnPropertyDescriptor(Editor.prototype, "handleInput")?.value;
    if (typeof value !== "function") return undefined;
    return value as Editor["handleInput"];
}

function patchStreamingBehaviorSwap(): void {
    const prototypeValue: unknown = AgentSession.prototype;
    const originalPrompt = getAgentSessionPrompt();
    if (originalPrompt === undefined) return;
    // SAFETY: The guarded AgentSession boundary verifies prompt before attaching
    // this private symbol marker to the smallest patchable prototype surface.
    const prototype = prototypeValue as PatchableAgentSessionPrototype;
    if (prototype[SWAP_MARKER] === true) return;

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

    const prototypeValue: unknown = Editor.prototype;
    const originalHandleInput = getEditorHandleInput();
    if (originalHandleInput === undefined) return;
    // SAFETY: The guarded pi-tui Editor boundary verifies handleInput before adding
    // this private marker to its minimal patchable prototype seam.
    const prototype = prototypeValue as PatchableEditorPrototype;
    if (prototype[TERMINAL_ENTER_MARKER] === true) return;

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
    const self = getEditorInternals(editor);
    if (self === undefined) return;
    const state = self.state;

    self.lastAction = null;
    if (state.cursorCol === 0 && state.cursorLine > 0) {
        state.cursorLine -= 1;
    }
    self.setCursorCol(0);
    editor.requestRenderNow?.();
}

function moveToCodexLineEnd(editor: EditorLike): void {
    const self = getEditorInternals(editor);
    if (self === undefined) return;
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
    const self = getEditorInternals(editor);
    if (self === undefined) return false;
    return typeof self.historyIndex === "number" && self.historyIndex > -1;
}

function shouldBlockPromptHistoryUp(editor: EditorLike): boolean {
    if (editor.isShowingAutocomplete()) return false;
    if (editor.getText().length === 0) return false;
    if (isBrowsingPromptHistory(editor)) return false;

    const cursor = editor.getCursor();
    return cursor.line === 0 && cursor.col === 0;
}

function deleteCurrentLine(
    editor: EditorLike,
    writeClipboard: ClipboardWriter,
    notify: Notifier,
): void {
    const internals = getEditorInternals(editor);
    if (internals === undefined) return;
    const currentLine = internals.state.lines[internals.state.cursorLine] ?? "";
    if (internals.pushUndoSnapshot === undefined) return;

    internals.pushUndoSnapshot();
    internals.exitHistoryBrowsing?.();
    internals.lastAction = null;

    if (internals.state.lines.length === 1) {
        internals.state.lines[0] = "";
        internals.state.cursorLine = 0;
    } else {
        internals.state.lines.splice(internals.state.cursorLine, 1);
        internals.state.cursorLine = Math.min(
            internals.state.cursorLine,
            internals.state.lines.length - 1,
        );
    }

    internals.setCursorCol(0);
    editor.onChange?.(editor.getText());
    editor.requestRenderNow?.();

    void writeClipboard(currentLine).catch(() => {
        notify("Could not copy the deleted line to the clipboard", "error");
    });
}

function enhanceEditor(
    editor: EditorLike,
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    requestRender: () => void,
    options: KeymapEditorOptions = {},
): EditorLike {
    const writeClipboard = options.writeClipboard ?? copyToClipboard;
    const notify = options.notify ?? (() => undefined);
    editor.requestRenderNow ??= requestRender;

    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        if (editor.onExtensionShortcut?.(data) === true) return;

        if (keybindings.matches(data, "app.models.clearAll")) {
            deleteCurrentLine(editor, writeClipboard, notify);
            return;
        }

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

export function applyKeymapEditor(
    ctx: KeymapEditorContext,
    options: KeymapEditorOptions = {},
): void {
    if (!ctx.hasUI) return;

    const configuredFactory = ctx.ui.getEditorComponent();
    let existing: WrappedEditorFactory | undefined;
    if (isWrappedEditorFactory(configuredFactory)) {
        existing = configuredFactory;
    }
    const baseFactory = existing?.[KEYMAP_FACTORY_BASE] ?? configuredFactory;
    const factory: WrappedEditorFactory = (tui, theme, keybindings) => {
        const editor =
            baseFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
        if (!isEditorLike(editor)) return editor;
        return enhanceEditor(editor, keybindings, () => tui.requestRender(), options);
    };
    factory[KEYMAP_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}

export default function piKeymap(pi: ExtensionAPI): void {
    applySubmitModeKeymap();

    pi.on("session_start", async (_event, ctx) => {
        const notify: Notifier = (message, type) => ctx.ui.notify(message, type);
        applyKeymapEditor(ctx, { notify });
    });
}
