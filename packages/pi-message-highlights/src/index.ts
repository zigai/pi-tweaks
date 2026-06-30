import { Editor } from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    getStylePrefix,
    highlightMessageLines,
    URL_BLUE_STYLE,
    type HighlightStyles,
} from "./highlight-text.ts";

const MESSAGE_HIGHLIGHTS_PATCH_KEY = Symbol.for("zigai.pi-message-highlights.patched");

type PatchState = typeof globalThis & {
    [MESSAGE_HIGHLIGHTS_PATCH_KEY]?: boolean;
};

type ThemeLike = {
    fg(color: "accent", text: string): string;
};

type HighlightStylesProvider = () => HighlightStyles;

type RenderablePrototype = {
    render(this: object, width: number): string[];
};

function getPatchState(): PatchState {
    return globalThis as PatchState;
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

function warnInternalPatchUnavailable(feature: string, error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(
        `[pi-message-highlights] ${feature} unavailable; Pi internals may have changed${suffix}`,
    );
}

async function loadPiTheme(): Promise<ThemeLike | undefined> {
    try {
        const distDir = await resolvePiDistDir();
        const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;
        // SAFETY: This imports Pi's own interactive theme module. The exported
        // proxy is intentionally stable across Pi module loaders and exposes
        // Theme.fg once the interactive theme is initialized.
        const themeModule = (await import(themePath)) as { theme?: ThemeLike };
        const theme = themeModule.theme;
        if (theme === undefined) return undefined;
        return {
            fg(color: "accent", text: string): string {
                return theme.fg(color, text);
            },
        };
    } catch (error: unknown) {
        warnInternalPatchUnavailable("theme color lookup", error);
    }
    return undefined;
}

async function loadComponentPrototype(
    fileName: string,
    exportName: string,
): Promise<RenderablePrototype | undefined> {
    try {
        const distDir = await resolvePiDistDir();
        const componentPath = pathToFileURL(
            join(distDir, "modes/interactive/components", fileName),
        ).href;
        const componentModule = (await import(componentPath)) as Record<string, unknown>;
        const exported = componentModule[exportName];
        if (typeof exported !== "function") {
            warnInternalPatchUnavailable(`${exportName} patch`);
            return undefined;
        }

        const prototype = Reflect.get(exported, "prototype");
        if (
            typeof prototype === "object" &&
            prototype !== null &&
            typeof Reflect.get(prototype, "render") === "function"
        ) {
            // SAFETY: Runtime checks above verified the render method required
            // by the RenderablePrototype patch seam.
            return prototype as RenderablePrototype;
        }
        warnInternalPatchUnavailable(`${exportName} patch`);
    } catch (error: unknown) {
        warnInternalPatchUnavailable(`${exportName} patch`, error);
    }
    return undefined;
}

function buildHighlightStyles(theme: ThemeLike | undefined): HighlightStyles {
    let filepath = "\u001b[38;5;81m";
    if (theme !== undefined) {
        try {
            const prefix = getStylePrefix((text: string) => theme.fg("accent", text));
            if (prefix.length > 0) {
                filepath = prefix;
            }
        } catch {
            // Theme may not be initialized yet during early startup renders.
            // Later renders will retry and pick up the native accent color.
        }
    }

    return {
        url: URL_BLUE_STYLE,
        filepath,
    };
}

function getEditorPrototype(): RenderablePrototype | undefined {
    const prototype = Editor.prototype as unknown;
    if (
        typeof prototype === "object" &&
        prototype !== null &&
        typeof Reflect.get(prototype, "render") === "function"
    ) {
        // SAFETY: Runtime checks above verified the render method required by
        // patchRenderablePrototype. Editor.prototype is the stable pi-tui seam
        // used by Pi's CustomEditor subclass.
        return prototype as RenderablePrototype;
    }
    warnInternalPatchUnavailable("Editor patch");
    return undefined;
}

function patchRenderablePrototype(
    prototype: RenderablePrototype,
    getStyles: HighlightStylesProvider,
): void {
    const originalRender = Reflect.get(prototype, "render") as
        | ((this: object, width: number) => string[])
        | undefined;
    if (typeof originalRender !== "function") return;

    prototype.render = function highlightedRender(this: object, width: number): string[] {
        return highlightMessageLines(originalRender.call(this, width), getStyles());
    };
}

async function installMessageHighlightPatch(): Promise<void> {
    const state = getPatchState();
    if (state[MESSAGE_HIGHLIGHTS_PATCH_KEY] === true) return;

    const theme = await loadPiTheme();
    const getStyles = () => buildHighlightStyles(theme);
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
    ) {
        return;
    }

    patchRenderablePrototype(assistantPrototype, getStyles);
    patchRenderablePrototype(userPrototype, getStyles);
    patchRenderablePrototype(editorPrototype, getStyles);

    state[MESSAGE_HIGHLIGHTS_PATCH_KEY] = true;
}

export default async function messageHighlightsExtension(): Promise<void> {
    await installMessageHighlightPatch();
}
