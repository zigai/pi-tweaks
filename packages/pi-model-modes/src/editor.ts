import {
    CustomEditor,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getCurrentMode, getModeBorderColor, setRequestEditorRender } from "./mode-state.ts";
import { shouldShowModeName } from "./settings.ts";

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (value: string) => value.replace(ANSI_SGR, "");
const MODE_FACTORY_BASE = Symbol.for("zigai.pi-model-modes.editor-factory-base");

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

type EditorLike = CustomEditor & {
    borderColor: (text: string) => string;
    getText(): string;
    render(width: number): string[];
};

type WrappedEditorFactory = EditorFactory & {
    [MODE_FACTORY_BASE]?: EditorFactory | undefined;
};

function modeLabelLine(lines: string[], width: number, editor: EditorLike): string[] {
    if (!shouldShowModeName()) return lines;

    const mode = getCurrentMode();
    if (mode.length === 0) return lines;

    const topPlain = stripAnsi(lines[0] ?? "");
    const scrollPrefixMatch = /^(─── ↑ \d+ more )/.exec(topPlain);
    const prefix = scrollPrefixMatch?.[1] ?? "──";

    let label = mode;
    let labelLeftSpace = " ";
    if (prefix.endsWith(" ")) {
        labelLeftSpace = "";
    }
    const labelRightSpace = " ";
    const minRightBorder = 1;
    const maxLabelLen = Math.max(
        0,
        width - prefix.length - labelLeftSpace.length - labelRightSpace.length - minRightBorder,
    );
    if (maxLabelLen <= 0) return lines;
    if (label.length > maxLabelLen) label = label.slice(0, maxLabelLen);

    const labelChunk = `${labelLeftSpace}${label}${labelRightSpace}`;
    const remaining = width - prefix.length - labelChunk.length;
    if (remaining < 0) return lines;

    const right = "─".repeat(Math.max(0, remaining));
    const borderColor = editor.borderColor;
    lines[0] = borderColor(prefix) + borderColor(labelChunk) + borderColor(right);
    return lines;
}

function enhanceEditor(
    editor: EditorLike,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    requestRender: () => void,
): EditorLike {
    const originalRender = editor.render.bind(editor);
    const defaultBorderColor = editor.borderColor;
    editor.render = (width: number) => modeLabelLine(originalRender(width), width, editor);

    const borderColor = (text: string) => {
        const isBashMode = editor.getText().trimStart().startsWith("!");
        if (isBashMode) {
            return ctx.ui.theme.getBashModeBorderColor()(text);
        }
        return getModeBorderColor(ctx, pi, getCurrentMode(), defaultBorderColor)(text);
    };

    Object.defineProperty(editor, "borderColor", {
        get: () => borderColor,
        set: () => {},
        configurable: true,
        enumerable: true,
    });

    setRequestEditorRender(requestRender);
    return editor;
}

export function applyModeEditor(pi: ExtensionAPI, ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    const existing = ctx.ui.getEditorComponent() as WrappedEditorFactory | undefined;
    const baseFactory = existing?.[MODE_FACTORY_BASE] ?? existing;
    const factory = ((tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as EditorLike;
        return enhanceEditor(editor, pi, ctx, () => tui.requestRender());
    }) as WrappedEditorFactory;
    factory[MODE_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}
