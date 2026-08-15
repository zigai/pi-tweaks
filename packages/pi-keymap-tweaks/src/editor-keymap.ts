import {
    copyToClipboard,
    CustomEditor,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerEditorEnhancer, type EditorEnhancerHandle } from "@zigai/pi-extension-internals";

const KEYMAP_EDITOR_ENHANCER = Symbol.for("zigai.pi-keymap-tweaks.editor-enhancer");

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
type EditorFactoryArgs = Parameters<EditorFactory>;
type EditorComponent = ReturnType<EditorFactory>;
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

export function applyKeymapEditor(
    ctx: KeymapEditorContext,
    options: KeymapEditorOptions = {},
): EditorEnhancerHandle<EditorFactoryArgs, EditorComponent> {
    return registerEditorEnhancer(
        ctx,
        KEYMAP_EDITOR_ENHANCER,
        (tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings),
        (editor, tui, _theme, keybindings) => {
            if (!isEditorLike(editor)) return editor;
            return enhanceEditor(editor, keybindings, () => tui.requestRender(), options);
        },
    );
}
