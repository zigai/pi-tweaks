import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { highlightEditorRenderLines, type EditorHighlightTarget } from "./editor-highlighting.ts";
import { highlightMessageLines, type HighlightStyles } from "./highlight-text.ts";
import { buildHighlightStyles, type HighlightTheme } from "./highlight-styles.ts";
import {
    DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG,
    loadMessageHighlightsSettings,
    type LoadedMessageHighlightsConfig,
} from "./settings.ts";

const MESSAGE_HIGHLIGHTS_PATCH_KEY = Symbol.for("zigai.pi-message-highlights.patched");
const RENDER_PATCH_PREDECESSOR_KEY = Symbol.for("zigai.pi-tweaks.render-patch-predecessor");

type PatchState = typeof globalThis & {
    [MESSAGE_HIGHLIGHTS_PATCH_KEY]?: MessageHighlightsPatchRecord | true;
};

type HighlightStylesProvider = () => HighlightStyles;

type RenderablePrototype = {
    render(this: object, width: number): string[];
};

type LinkedRenderMethod = RenderablePrototype["render"] & {
    [RENDER_PATCH_PREDECESSOR_KEY]?: RenderablePrototype["render"];
};

function getRenderPredecessor(
    render: RenderablePrototype["render"],
): RenderablePrototype["render"] | undefined {
    const predecessor: unknown = Reflect.get(render, RENDER_PATCH_PREDECESSOR_KEY) as unknown;
    if (typeof predecessor !== "function") return undefined;
    // SAFETY: Render wrappers in this repository store only RenderablePrototype.render
    // under this private symbol; the runtime check verifies it is callable.
    return predecessor as RenderablePrototype["render"];
}

function removeLinkedRenderPatch(
    prototype: RenderablePrototype,
    patchedRender: LinkedRenderMethod,
): void {
    const predecessor = getRenderPredecessor(patchedRender);
    if (predecessor === undefined) return;

    const currentRenderValue: unknown = Reflect.get(prototype, "render");
    if (typeof currentRenderValue !== "function") return;
    // SAFETY: The runtime guard verifies the render method required by RenderablePrototype.
    const currentRender = currentRenderValue as RenderablePrototype["render"];
    if (currentRender === patchedRender) {
        prototype.render = predecessor;
        return;
    }

    const visited = new Set<RenderablePrototype["render"]>();
    let current = currentRender;
    while (!visited.has(current)) {
        visited.add(current);
        const next = getRenderPredecessor(current);
        if (next === undefined) return;
        if (next === patchedRender) {
            Reflect.set(current, RENDER_PATCH_PREDECESSOR_KEY, predecessor);
            return;
        }
        current = next;
    }
}

type RenderPatchRecord = {
    prototype: RenderablePrototype;
    originalRender: RenderablePrototype["render"];
    patchedRender: LinkedRenderMethod;
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
        removeLinkedRenderPatch(renderPatch.prototype, renderPatch.patchedRender);
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

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

async function loadPiTheme(): Promise<HighlightTheme | undefined> {
    try {
        const distDir = await resolvePiDistDir();
        const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;
        // SAFETY: This imports Pi's own interactive theme module. The exported
        // proxy is intentionally stable across Pi module loaders and exposes
        // Theme.fg/getColorMode once the interactive theme is initialized.
        const themeModule: unknown = (await import(themePath)) as unknown;
        const theme = getUnknownProperty(themeModule, "theme");
        if (typeof theme !== "object" || theme === null) {
            warnInternalPatchUnavailable("theme color lookup");
            return undefined;
        }
        return {
            fg(color, text): string {
                const fg = getUnknownProperty(theme, "fg");
                if (typeof fg !== "function") {
                    throw new Error("Theme.fg unavailable");
                }
                const styled: unknown = Reflect.apply(fg, theme, [color, text]) as unknown;
                if (typeof styled !== "string") {
                    throw new Error("Theme.fg returned a non-string value");
                }
                return styled;
            },
            getColorMode(): "truecolor" | "256color" {
                const getColorMode = getUnknownProperty(theme, "getColorMode");
                if (typeof getColorMode !== "function") {
                    throw new Error("Theme.getColorMode unavailable");
                }
                const colorMode: unknown = Reflect.apply(getColorMode, theme, []) as unknown;
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
        const componentModule: unknown = (await import(componentPath)) as unknown;
        const exported = getUnknownProperty(componentModule, exportName);
        if (typeof exported !== "function") {
            warnInternalPatchUnavailable(`${exportName} patch`);
            return undefined;
        }

        const prototype: unknown = Reflect.get(exported, "prototype") as unknown;
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
    const prototype: unknown = Editor.prototype;
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

    const patchedRender: LinkedRenderMethod = function highlightedRender(
        this: object,
        width: number,
    ): string[] {
        const predecessor = getRenderPredecessor(patchedRender) ?? originalRender;
        return highlightMessageLines(predecessor.call(this, width), getStyles());
    };
    patchedRender[RENDER_PATCH_PREDECESSOR_KEY] = originalRender;
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

    const patchedRender: LinkedRenderMethod = function highlightedEditorRender(
        this: object,
        width: number,
    ): string[] {
        const predecessor = getRenderPredecessor(patchedRender) ?? originalRender;
        const renderedLines = predecessor.call(this, width);
        if (isEditorHighlightTarget(this)) {
            return highlightEditorRenderLines(this, width, renderedLines, getStyles());
        }
        return highlightMessageLines(renderedLines, getStyles());
    };
    patchedRender[RENDER_PATCH_PREDECESSOR_KEY] = originalRender;
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
    const loaded = loadMessageHighlightsSettings(ctx.cwd, ctx.isProjectTrusted());
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
