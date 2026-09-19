import { Editor } from "@earendil-works/pi-tui";
import {
    installLinkedRenderPatch,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";
import type { EditorMaxHeight } from "./settings-input.ts";

const EDITOR_HEIGHT_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.editor-height-patch");

export type EditorHeightConfig = {
    readonly editorMaxHeight: EditorMaxHeight;
    readonly showEditorOverflowIndicators: boolean;
};

export type EditorHeightHandle = {
    update(config: EditorHeightConfig): void;
    dispose(): void;
};

type TerminalLike = {
    rows: number;
};

type TuiLike = {
    terminal: TerminalLike;
};

type EditorRenderTarget = {
    [EDITOR_HEIGHT_PATCH_KEY]?: EditorHeightPatchRecord;
    render(width: number): string[];
};

type EditorRenderTargetView = EditorRenderTarget & {
    tui?: TuiLike;
};

type EditorHeightPatchRecord = {
    readonly original: EditorRenderTarget["render"];
    readonly patch: LinkedMethodPatchHandle<EditorRenderTarget, [number], string[]>;
    readonly handle: EditorHeightHandle;
};

type RenderView = {
    readonly render?: unknown;
};

function warnEditorHeightPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined && reason.length > 0) {
        suffix = `: ${reason}`;
    }

    console.warn(
        `[pi-ui-tweaks] editor height patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function isEditorRenderTarget(value: unknown): value is EditorRenderTarget {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    // SAFETY: RenderView permits checking the optional render function property.
    const view = value as RenderView;
    return typeof view.render === "function";
}

function isNumericMaxHeight(value: EditorMaxHeight): value is number {
    return typeof value === "number" && value > 0;
}

function getTargetMaxLines(maxH: EditorMaxHeight, terminalRows: number): number {
    const maxScreenHeight = Math.max(5, terminalRows - 4);

    if (isNumericMaxHeight(maxH)) {
        return Math.min(maxH, maxScreenHeight);
    }

    return maxScreenHeight;
}

function getEditorTui(editor: EditorRenderTarget): TuiLike | undefined {
    // SAFETY: Accessing protected tui property when defined on editor instance.
    const view: Partial<EditorRenderTargetView> = editor;
    return view.tui;
}

function renderWithProxiedTerminalRows(
    editor: EditorRenderTarget,
    targetMaxLines: number,
    renderFn: () => string[],
): string[] {
    const tui = getEditorTui(editor);
    if (tui?.terminal === undefined) {
        return renderFn();
    }

    const originalTerminal = tui.terminal;
    const fakeRows = Math.ceil((targetMaxLines + 1) / 0.3);

    const proxiedTerminal: TerminalLike = {
        get rows(): number {
            return fakeRows;
        },
    };

    // SAFETY: Set prototype on terminal delegate so all terminal methods remain accessible.
    Object.setPrototypeOf(proxiedTerminal, originalTerminal);

    try {
        tui.terminal = proxiedTerminal;
        return renderFn();
    } finally {
        tui.terminal = originalTerminal;
    }
}

/** Installs or updates the editor height limit and overflow indicators patch. */
export function installEditorHeightPatch(
    config: EditorHeightConfig,
    target: EditorRenderTarget = Editor.prototype,
): EditorHeightHandle {
    if (!isEditorRenderTarget(target)) {
        warnEditorHeightPatchUnavailable();

        return { update(): void {}, dispose(): void {} };
    }

    const installed = target[EDITOR_HEIGHT_PATCH_KEY];
    if (installed !== undefined) {
        installed.handle.update(config);
        return installed.handle;
    }

    let current = config;
    const patch = installLinkedRenderPatch(
        target,
        (predecessor) =>
            function editorHeightRender(this: EditorRenderTarget, width: number): string[] {
                const maxH = current.editorMaxHeight;
                const tui = getEditorTui(this);
                const terminalRows = tui?.terminal.rows ?? 24;
                const targetMaxLines = getTargetMaxLines(maxH, terminalRows);

                return renderWithProxiedTerminalRows(this, targetMaxLines, () =>
                    predecessor.call(this, width),
                );
            },
    );
    let disposed = false;
    const handle: EditorHeightHandle = {
        update(next): void {
            if (!disposed) current = next;
        },
        dispose(): void {
            if (disposed) return;

            disposed = true;
            patch.dispose();

            if (target[EDITOR_HEIGHT_PATCH_KEY]?.handle === handle) {
                delete target[EDITOR_HEIGHT_PATCH_KEY];
            }
        },
    };

    target[EDITOR_HEIGHT_PATCH_KEY] = { original: patch.predecessor, patch, handle };
    return handle;
}
