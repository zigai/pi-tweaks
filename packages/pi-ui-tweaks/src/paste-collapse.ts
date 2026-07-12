import {
    CustomEditor,
    type ExtensionContext,
    type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { Editor, matchesKey } from "@earendil-works/pi-tui";

import {
    hasEditorFactoryLayer,
    markEditorFactoryLayer,
    type EditorFactory,
} from "./editor-factory-layers.ts";
import { getUiTweaksPatchState, type UiTweaksPatchState } from "./patch-state.ts";

const PASTE_COLLAPSE_PATCH_MARKER = Symbol.for("zigai.pi-ui-tweaks.paste-collapse-patched");
const PASTE_MARKER_REGEX = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;
const PASTE_MARKER_FOR_ID = (pasteId: number): RegExp =>
    new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`);
const ESCAPE_CHARACTER = String.fromCharCode(27);
const CSI_U_CTRL_SEQUENCE_REGEX = new RegExp(`${ESCAPE_CHARACTER}\\[(\\d+);5u`, "g");

function matchesRuntimeKey(data: string, keyId: string): boolean {
    return Reflect.apply(matchesKey, undefined, [data, keyId]) === true;
}

type PasteMarker = {
    readonly pasteId: number;
    readonly content: string;
    readonly line: number;
    readonly start: number;
    readonly end: number;
};

export type PasteCollapseEditorContext = Pick<ExtensionContext, "hasUI"> & {
    ui: Pick<ExtensionContext["ui"], "getEditorComponent" | "setEditorComponent">;
};

/** Configurable paste-collapse behavior copied into the global patch state. */
export type PasteCollapseSettings = Pick<
    UiTweaksPatchState,
    | "pasteCollapseCharThreshold"
    | "pasteCollapseEnabled"
    | "pasteCollapseExpandKey"
    | "pasteCollapseLineThreshold"
    | "pasteCollapseUseToolExpandKey"
>;

type EditorState = {
    lines: string[];
    cursorLine: number;
    cursorCol: number;
};

type PasteEditorInternals = {
    state: EditorState;
    pastes: Map<number, string>;
    pasteCounter: number;
    lastAction: unknown;
    cancelAutocomplete(): void;
    exitHistoryBrowsing(): void;
    getText(): string;
    insertTextAtCursorInternal(text: string): void;
    normalizeText(text: string): string;
    pushUndoSnapshot(): void;
    setCursorCol(column: number): void;
    onChange?: (text: string) => void;
};

/** Minimal editor surface needed to expand collapsed paste markers. */
export type PasteCollapseEditor = {
    getCursor(): { line: number; col: number };
    getText(): string;
    handleInput(data: string): void;
    onExtensionShortcut?: (data: string) => boolean;
    requestRenderNow?: () => void;
};

type EditorLike = CustomEditor & PasteCollapseEditor;

function asObject(value: unknown): object | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    return value;
}

function getPasteEditorInternals(editor: unknown): PasteEditorInternals | undefined {
    const value = asObject(editor);
    if (value === undefined) {
        return undefined;
    }

    const state: unknown = Reflect.get(value, "state");
    const stateValue = asObject(state);
    let lines: unknown;
    let cursorLine: unknown;
    let cursorCol: unknown;
    if (stateValue !== undefined) {
        lines = Reflect.get(stateValue, "lines");
        cursorLine = Reflect.get(stateValue, "cursorLine");
        cursorCol = Reflect.get(stateValue, "cursorCol");
    }
    const pastes: unknown = Reflect.get(value, "pastes");

    if (!Array.isArray(lines)) {
        return undefined;
    }
    if (!lines.every((line) => typeof line === "string")) {
        return undefined;
    }
    if (typeof cursorLine !== "number" || typeof cursorCol !== "number") {
        return undefined;
    }
    if (!(pastes instanceof Map)) {
        return undefined;
    }

    const requiredMethods = [
        "cancelAutocomplete",
        "exitHistoryBrowsing",
        "getText",
        "insertTextAtCursorInternal",
        "normalizeText",
        "pushUndoSnapshot",
        "setCursorCol",
    ] as const;

    for (const method of requiredMethods) {
        if (typeof Reflect.get(value, method) !== "function") {
            return undefined;
        }
    }

    // SAFETY: The state, paste store, and private editor methods were verified above.
    return editor as PasteEditorInternals;
}

function decodeTerminalControlSequences(pastedText: string): string {
    return pastedText.replace(CSI_U_CTRL_SEQUENCE_REGEX, (match, code) => {
        const codepoint = Number(code);
        if (codepoint >= 97 && codepoint <= 122) {
            return String.fromCharCode(codepoint - 96);
        }
        if (codepoint >= 65 && codepoint <= 90) {
            return String.fromCharCode(codepoint - 64);
        }
        return match;
    });
}

function normalizePastedText(editor: PasteEditorInternals, pastedText: string): string {
    const decodedText = decodeTerminalControlSequences(pastedText);
    const cleanText = editor.normalizeText(decodedText);
    let filteredText = cleanText
        .split("")
        .filter((character) => character === "\n" || character.charCodeAt(0) >= 32)
        .join("");

    if (/^[/~.]/.test(filteredText)) {
        const currentLine = editor.state.lines[editor.state.cursorLine] ?? "";
        let charBeforeCursor = "";
        if (editor.state.cursorCol > 0) {
            charBeforeCursor = currentLine[editor.state.cursorCol - 1] ?? "";
        }
        if (charBeforeCursor.length > 0 && /\w/.test(charBeforeCursor)) {
            filteredText = ` ${filteredText}`;
        }
    }

    return filteredText;
}

function shouldCollapsePaste(filteredText: string): boolean {
    const state = getUiTweaksPatchState();
    if (!state.pasteCollapseEnabled) {
        return false;
    }

    const lineCount = filteredText.split("\n").length;
    return (
        lineCount > state.pasteCollapseLineThreshold ||
        filteredText.length > state.pasteCollapseCharThreshold
    );
}

function pasteMarkerForContent(pasteId: number, filteredText: string): string {
    const lineCount = filteredText.split("\n").length;
    if (lineCount > getUiTweaksPatchState().pasteCollapseLineThreshold) {
        return `[paste #${pasteId} +${lineCount} lines]`;
    }

    return `[paste #${pasteId} ${filteredText.length} chars]`;
}

function handlePasteWithUiTweaks(editor: PasteEditorInternals, pastedText: string): void {
    editor.cancelAutocomplete();
    editor.exitHistoryBrowsing();
    editor.lastAction = null;
    editor.pushUndoSnapshot();

    const filteredText = normalizePastedText(editor, pastedText);
    if (shouldCollapsePaste(filteredText)) {
        editor.pasteCounter += 1;
        const pasteId = editor.pasteCounter;
        editor.pastes.set(pasteId, filteredText);
        editor.insertTextAtCursorInternal(pasteMarkerForContent(pasteId, filteredText));
        return;
    }

    editor.insertTextAtCursorInternal(filteredText);
}

function findPasteMarkerAtCursor(editor: PasteEditorInternals): PasteMarker | undefined {
    const line = editor.state.lines[editor.state.cursorLine] ?? "";
    const cursorCol = editor.state.cursorCol;

    for (const match of line.matchAll(PASTE_MARKER_REGEX)) {
        const pasteIdText = match[1];
        const start = match.index;
        if (pasteIdText === undefined || start === undefined) {
            continue;
        }

        const pasteId = Number.parseInt(pasteIdText, 10);
        const markerText = match[0];
        const end = start + markerText.length;
        if (cursorCol < start || cursorCol > end) {
            continue;
        }

        const content = editor.pastes.get(pasteId);
        if (content === undefined) {
            continue;
        }

        return {
            pasteId,
            content,
            line: editor.state.cursorLine,
            start,
            end,
        };
    }

    return undefined;
}

function hasPasteMarker(editor: PasteEditorInternals, pasteId: number): boolean {
    const markerRegex = PASTE_MARKER_FOR_ID(pasteId);
    return editor.state.lines.some((line) => markerRegex.test(line));
}

function replaceMarkerWithContent(editor: PasteEditorInternals, marker: PasteMarker): void {
    const line = editor.state.lines[marker.line] ?? "";
    const before = line.slice(0, marker.start);
    const after = line.slice(marker.end);
    const replacementLines = marker.content.split("\n");
    const firstReplacementLine = replacementLines[0] ?? "";

    if (replacementLines.length === 1) {
        editor.state.lines[marker.line] = `${before}${firstReplacementLine}${after}`;
    } else {
        const middleReplacementLines = replacementLines.slice(1, -1);
        const lastReplacementLine = replacementLines[replacementLines.length - 1] ?? "";
        editor.state.lines.splice(
            marker.line,
            1,
            `${before}${firstReplacementLine}`,
            ...middleReplacementLines,
            `${lastReplacementLine}${after}`,
        );
    }

    editor.state.cursorLine = marker.line;
    editor.setCursorCol(marker.start);
    if (!hasPasteMarker(editor, marker.pasteId)) {
        editor.pastes.delete(marker.pasteId);
    }
    editor.onChange?.(editor.getText());
}

/**
 * Expands the collapsed paste marker currently under the editor cursor.
 */
export function expandPasteMarkerAtCursor(editor: PasteCollapseEditor): boolean {
    const internals = getPasteEditorInternals(editor);
    if (internals === undefined) {
        return false;
    }

    const marker = findPasteMarkerAtCursor(internals);
    if (marker === undefined) {
        return false;
    }

    internals.lastAction = null;
    internals.pushUndoSnapshot();
    replaceMarkerWithContent(internals, marker);
    editor.requestRenderNow?.();
    return true;
}

/**
 * Copies parsed paste-collapse settings into the live editor patch state.
 */
export function setPasteCollapseSettings(settings: PasteCollapseSettings): void {
    const state = getUiTweaksPatchState();
    state.pasteCollapseCharThreshold = settings.pasteCollapseCharThreshold;
    state.pasteCollapseEnabled = settings.pasteCollapseEnabled;
    state.pasteCollapseExpandKey = settings.pasteCollapseExpandKey;
    state.pasteCollapseLineThreshold = settings.pasteCollapseLineThreshold;
    state.pasteCollapseUseToolExpandKey = settings.pasteCollapseUseToolExpandKey;
}

function installPasteCollapsePatchOnPrototype(prototype: object): void {
    if (Reflect.get(prototype, PASTE_COLLAPSE_PATCH_MARKER) === true) {
        return;
    }

    const originalHandlePaste: unknown = Reflect.get(prototype, "handlePaste") as unknown;
    if (typeof originalHandlePaste !== "function") {
        return;
    }

    Reflect.set(
        prototype,
        "handlePaste",
        function handlePasteWithConfig(this: unknown, pastedText: string): void {
            const internals = getPasteEditorInternals(this);
            if (internals === undefined) {
                Reflect.apply(originalHandlePaste, this, [pastedText]);
                return;
            }

            handlePasteWithUiTweaks(internals, pastedText);
        },
    );

    Reflect.set(prototype, PASTE_COLLAPSE_PATCH_MARKER, true);
}

/**
 * Installs the configurable paste collapse patch on Pi editor prototypes.
 */
export function installPasteCollapsePatch(prototype?: object): void {
    if (prototype !== undefined) {
        installPasteCollapsePatchOnPrototype(prototype);
        return;
    }

    installPasteCollapsePatchOnPrototype(Editor.prototype);

    const customEditorBasePrototype: unknown = Object.getPrototypeOf(CustomEditor.prototype);
    if (typeof customEditorBasePrototype === "object" && customEditorBasePrototype !== null) {
        installPasteCollapsePatchOnPrototype(customEditorBasePrototype);
    }
}

function matchesConfiguredExpandKey(data: string): boolean {
    const expandKey = getUiTweaksPatchState().pasteCollapseExpandKey;
    if (expandKey === null) {
        return false;
    }

    return matchesRuntimeKey(data, expandKey);
}

function shouldTryExpandPasteMarker(data: string, keybindings: KeybindingsManager): boolean {
    if (matchesConfiguredExpandKey(data)) {
        return true;
    }

    return (
        getUiTweaksPatchState().pasteCollapseUseToolExpandKey &&
        keybindings.matches(data, "app.tools.expand")
    );
}

function isEditorLike(value: ReturnType<EditorFactory>): value is EditorLike {
    const getCursor: unknown = Reflect.get(value, "getCursor") as unknown;
    const getText: unknown = Reflect.get(value, "getText") as unknown;
    const handleInput: unknown = Reflect.get(value, "handleInput") as unknown;
    return (
        typeof getCursor === "function" &&
        typeof getText === "function" &&
        typeof handleInput === "function"
    );
}

function enhanceEditor(
    editor: EditorLike,
    keybindings: KeybindingsManager,
    requestRender: () => void,
): EditorLike {
    editor.requestRenderNow ??= requestRender;

    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        if (shouldTryExpandPasteMarker(data, keybindings)) {
            if (editor.onExtensionShortcut?.(data) === true) {
                return;
            }
            if (expandPasteMarkerAtCursor(editor)) {
                return;
            }
        }

        originalHandleInput(data);
    };

    return editor;
}

/**
 * Wraps the active editor factory so configured keys can expand one paste marker.
 */
export function applyPasteCollapseEditor(ctx: PasteCollapseEditorContext): void {
    if (!ctx.hasUI) {
        return;
    }

    const existing = ctx.ui.getEditorComponent();
    if (hasEditorFactoryLayer(existing, "pasteCollapse")) {
        return;
    }

    const baseFactory = existing;
    const factory: EditorFactory = (tui, theme, keybindings) => {
        const editor =
            baseFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
        if (!isEditorLike(editor)) return editor;
        return enhanceEditor(editor, keybindings, () => tui.requestRender());
    };
    markEditorFactoryLayer(factory, existing, "pasteCollapse");

    ctx.ui.setEditorComponent(factory);
}
