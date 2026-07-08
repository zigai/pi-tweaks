import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { highlightEditorRenderLines, type EditorHighlightTarget } from "./editor-highlighting.ts";
import { highlightMessageLines, type HighlightStyles } from "./highlight-text.ts";
import { buildHighlightStyles, type HighlightTheme } from "./highlight-styles.ts";
import {
    DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG,
    loadMessageHighlightsConfig,
    type LoadedMessageHighlightsConfig,
} from "./settings.ts";

const MESSAGE_HIGHLIGHTS_PATCH_KEY = Symbol.for("zigai.pi-message-highlights.patched");

type PatchState = typeof globalThis & {
    [MESSAGE_HIGHLIGHTS_PATCH_KEY]?: MessageHighlightsPatchRecord | true;
};

type HighlightStylesProvider = () => HighlightStyles;

type RenderablePrototype = {
    render(this: object, width: number): string[];
};

type RenderPatchRecord = {
    prototype: RenderablePrototype;
    originalRender: RenderablePrototype["render"];
    patchedRender: RenderablePrototype["render"];
};

type MessageHighlightsPatchRecord = {
    patches: RenderPatchRecord[];
};

let activeConfig = DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG;
const reportedConfigErrors = new Set<string>();

function getPatchState(): PatchState {
    return globalThis as PatchState;
}

function restoreMessageHighlightPatch(): void {
    const state = getPatchState();
    const patch = state[MESSAGE_HIGHLIGHTS_PATCH_KEY];
    if (patch === undefined || patch === true) {
        return;
    }

    for (const renderPatch of patch.patches) {
        if (renderPatch.prototype.render === renderPatch.patchedRender) {
            renderPatch.prototype.render = renderPatch.originalRender;
        }
    }
    delete state[MESSAGE_HIGHLIGHTS_PATCH_KEY];
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

async function loadPiTheme(): Promise<HighlightTheme | undefined> {
    try {
        const distDir = await resolvePiDistDir();
        const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;
        // SAFETY: This imports Pi's own interactive theme module. The exported
        // proxy is intentionally stable across Pi module loaders and exposes
        // Theme.fg/getColorMode once the interactive theme is initialized.
        const themeModule = (await import(themePath)) as { theme?: unknown };
        const theme = themeModule.theme;
        if (typeof theme !== "object" || theme === null) {
            warnInternalPatchUnavailable("theme color lookup");
            return undefined;
        }
        return {
            fg(color, text): string {
                const fg = Reflect.get(theme, "fg");
                if (typeof fg !== "function") {
                    throw new Error("Theme.fg unavailable");
                }
                const styled = fg.call(theme, color, text) as unknown;
                if (typeof styled !== "string") {
                    throw new Error("Theme.fg returned a non-string value");
                }
                return styled;
            },
            getColorMode(): "truecolor" | "256color" {
                const getColorMode = Reflect.get(theme, "getColorMode");
                if (typeof getColorMode !== "function") {
                    throw new Error("Theme.getColorMode unavailable");
                }
                const colorMode = getColorMode.call(theme) as unknown;
                if (colorMode !== "truecolor" && colorMode !== "256color") {
                    throw new Error("Theme.getColorMode returned an unsupported value");
                }
                return colorMode;
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
): RenderPatchRecord | undefined {
    const originalRender = Reflect.get(prototype, "render") as
        | ((this: object, width: number) => string[])
        | undefined;
    if (typeof originalRender !== "function") return undefined;

    const patchedRender = function highlightedRender(this: object, width: number): string[] {
        return highlightMessageLines(originalRender.call(this, width), getStyles());
    };
    prototype.render = patchedRender;

    return {
        prototype,
        originalRender,
        patchedRender,
    };
}

type EditorHighlightPrototype = RenderablePrototype & {
    getText(this: object): string;
};

function isEditorHighlightPrototype(
    prototype: RenderablePrototype,
): prototype is EditorHighlightPrototype {
    return typeof Reflect.get(prototype, "getText") === "function";
}

function isEditorHighlightTarget(value: object): value is EditorHighlightTarget {
    return typeof Reflect.get(value, "getText") === "function";
}

function patchEditorPrototype(
    prototype: RenderablePrototype,
    getStyles: HighlightStylesProvider,
): RenderPatchRecord | undefined {
    if (!isEditorHighlightPrototype(prototype)) return undefined;

    const originalRender = Reflect.get(prototype, "render") as
        | ((this: object, width: number) => string[])
        | undefined;
    if (typeof originalRender !== "function") return undefined;

    const patchedRender = function highlightedEditorRender(this: object, width: number): string[] {
        const renderedLines = originalRender.call(this, width);
        if (isEditorHighlightTarget(this)) {
            return highlightEditorRenderLines(this, width, renderedLines, getStyles());
        }
        return highlightMessageLines(renderedLines, getStyles());
    };
    prototype.render = patchedRender;

    return {
        prototype,
        originalRender,
        patchedRender,
    };
}

async function installMessageHighlightPatch(): Promise<void> {
    const state = getPatchState();
    if (state[MESSAGE_HIGHLIGHTS_PATCH_KEY] !== undefined) return;

    const theme = await loadPiTheme();
    const getStyles = () => buildHighlightStyles(theme, activeConfig);
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

    const patches: RenderPatchRecord[] = [];
    const assistantPatch = patchRenderablePrototype(assistantPrototype, getStyles);
    if (assistantPatch !== undefined) patches.push(assistantPatch);
    const userPatch = patchRenderablePrototype(userPrototype, getStyles);
    if (userPatch !== undefined) patches.push(userPatch);
    const editorPatch = patchEditorPrototype(editorPrototype, getStyles);
    if (editorPatch !== undefined) patches.push(editorPatch);

    state[MESSAGE_HIGHLIGHTS_PATCH_KEY] = { patches };
}

function reportConfigErrors(ctx: ExtensionContext, loaded: LoadedMessageHighlightsConfig): void {
    for (const error of loaded.errors) {
        if (reportedConfigErrors.has(error)) {
            continue;
        }
        reportedConfigErrors.add(error);
        ctx.ui.notify(`[pi-message-highlights] ${error}`, "error");
    }
}

function applyMessageHighlightsConfig(ctx: ExtensionContext): void {
    const loaded = loadMessageHighlightsConfig(ctx.cwd, ctx.isProjectTrusted());
    activeConfig = loaded.config;
    reportConfigErrors(ctx, loaded);
}

export default async function messageHighlightsExtension(pi?: ExtensionAPI): Promise<void> {
    await installMessageHighlightPatch();
    pi?.on("session_start", (_event, ctx) => {
        applyMessageHighlightsConfig(ctx);
    });
    pi?.on("session_shutdown", () => {
        restoreMessageHighlightPatch();
    });
}
