import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import {
    installLinkedRenderPatch,
    loadPiInternalModule,
    warnPiInternalPatchUnavailable,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

import { highlightEditorRenderLines, type EditorHighlightTarget } from "./editor-highlighting.ts";
import { highlightMessageLines, type HighlightStyles } from "./highlight-text.ts";
import { buildHighlightStyles, type HighlightTheme } from "./highlight-styles.ts";
import type { MessageHighlightsConfig } from "./settings.ts";

import { messageHighlightSettings } from "./settings-controller.ts";

const MESSAGE_HIGHLIGHTS_PATCH_KEY = Symbol.for("zigai.pi-message-highlights.patched");
const SCOPE = "pi-message-highlights";

type HighlightStylesProvider = () => HighlightStyles;
type RenderablePrototype = { render(this: object, width: number): string[] };
type RenderPatchHandle = LinkedMethodPatchHandle<object, [width: number], string[]>;
type MessageHighlightsPatchRecord = { patches: RenderPatchHandle[] };
type PatchState = typeof globalThis & {
    [MESSAGE_HIGHLIGHTS_PATCH_KEY]?: MessageHighlightsPatchRecord | true;
};

type EditorHighlightPrototype = RenderablePrototype & { getText(this: object): string };

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function parseTheme(module: unknown): HighlightTheme | undefined {
    const theme = getUnknownProperty(module, "theme");
    if (typeof theme !== "object" || theme === null) return undefined;
    return {
        fg(color, text): string {
            const fg = getUnknownProperty(theme, "fg");
            if (typeof fg !== "function") throw new Error("Theme.fg unavailable");
            const styled: unknown = Reflect.apply(fg, theme, [color, text]);
            if (typeof styled !== "string") throw new Error("Theme.fg returned a non-string value");
            return styled;
        },
        getColorMode(): "truecolor" | "256color" {
            const getColorMode = getUnknownProperty(theme, "getColorMode");
            if (typeof getColorMode !== "function")
                throw new Error("Theme.getColorMode unavailable");
            const mode: unknown = Reflect.apply(getColorMode, theme, []);
            if (mode !== "truecolor" && mode !== "256color") {
                throw new Error("Theme.getColorMode returned an unsupported value");
            }
            return mode;
        },
    };
}

function parseRenderablePrototype(exportName: string) {
    return (module: unknown): RenderablePrototype | undefined => {
        const exported = getUnknownProperty(module, exportName);
        const prototype = getUnknownProperty(exported, "prototype");
        if (
            (typeof prototype === "object" || typeof prototype === "function") &&
            prototype !== null &&
            typeof getUnknownProperty(prototype, "render") === "function"
        ) {
            return prototype as RenderablePrototype;
        }
        return undefined;
    };
}

async function loadComponentPrototype(
    fileName: string,
    exportName: string,
): Promise<RenderablePrototype | undefined> {
    return loadPiInternalModule(`modes/interactive/components/${fileName}`, {
        scope: SCOPE,
        feature: `${exportName} patch`,
        parse: parseRenderablePrototype(exportName),
    });
}

function getEditorPrototype(): RenderablePrototype | undefined {
    const prototype: unknown = Editor.prototype;
    if (
        typeof prototype === "object" &&
        prototype !== null &&
        typeof Reflect.get(prototype, "render") === "function"
    ) {
        return prototype as RenderablePrototype;
    }
    warnPiInternalPatchUnavailable(SCOPE, "Editor patch");
    return undefined;
}

function isEditorHighlightPrototype(
    prototype: RenderablePrototype,
): prototype is EditorHighlightPrototype {
    return typeof Reflect.get(prototype, "getText") === "function";
}

function isEditorHighlightTarget(value: object): value is EditorHighlightTarget {
    return typeof Reflect.get(value, "getText") === "function";
}

function patchRenderablePrototype(
    prototype: RenderablePrototype,
    getStyles: HighlightStylesProvider,
): RenderPatchHandle {
    return installLinkedRenderPatch(
        prototype,
        (predecessor) =>
            function highlightedRender(this: object, width: number): string[] {
                return highlightMessageLines(predecessor.call(this, width), getStyles());
            },
    );
}

function patchEditorPrototype(
    prototype: RenderablePrototype,
    getStyles: HighlightStylesProvider,
): RenderPatchHandle | undefined {
    if (!isEditorHighlightPrototype(prototype)) return undefined;
    return installLinkedRenderPatch(
        prototype,
        (predecessor) =>
            function highlightedEditorRender(this: object, width: number): string[] {
                const renderedLines = predecessor.call(this, width);
                if (isEditorHighlightTarget(this)) {
                    return highlightEditorRenderLines(this, width, renderedLines, getStyles());
                }
                return highlightMessageLines(renderedLines, getStyles());
            },
    );
}

function restoreMessageHighlightPatch(): void {
    const state: PatchState = globalThis;
    const patch = state[MESSAGE_HIGHLIGHTS_PATCH_KEY];
    if (patch === undefined || patch === true) return;
    for (const renderPatch of patch.patches) renderPatch.dispose();
    delete state[MESSAGE_HIGHLIGHTS_PATCH_KEY];
}

async function installMessageHighlightPatch(
    getConfig: () => MessageHighlightsConfig,
): Promise<void> {
    const state: PatchState = globalThis;
    if (state[MESSAGE_HIGHLIGHTS_PATCH_KEY] !== undefined) return;

    const theme = await loadPiInternalModule("modes/interactive/theme/theme.js", {
        scope: SCOPE,
        feature: "theme color lookup",
        parse: parseTheme,
    });
    const getStyles = () => buildHighlightStyles(theme, getConfig());
    const assistantPrototype = await loadComponentPrototype(
        "assistant-message.js",
        "AssistantMessageComponent",
    );
    const userPrototype = await loadComponentPrototype("user-message.js", "UserMessageComponent");
    const editorPrototype = getEditorPrototype();
    if (
        assistantPrototype === undefined ||
        userPrototype === undefined ||
        editorPrototype === undefined
    )
        return;

    const patches: RenderPatchHandle[] = [
        patchRenderablePrototype(assistantPrototype, getStyles),
        patchRenderablePrototype(userPrototype, getStyles),
    ];
    const editorPatch = patchEditorPrototype(editorPrototype, getStyles);
    if (editorPatch !== undefined) patches.push(editorPatch);
    state[MESSAGE_HIGHLIGHTS_PATCH_KEY] = { patches };
}

export default async function messageHighlightsExtension(pi?: ExtensionAPI): Promise<void> {
    await installMessageHighlightPatch(messageHighlightSettings.getConfig);
    pi?.on("session_start", (_event, ctx) => messageHighlightSettings.apply(ctx));
    pi?.on("session_shutdown", restoreMessageHighlightPatch);
}
