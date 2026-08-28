import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import {
    installLinkedRenderPatch,
    loadPiInternalModule,
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
type RenderableInstance = {
    render(width: number): string[];
};
type RenderablePrototype = { render(this: RenderableInstance, width: number): string[] };
type RenderPatchHandle = LinkedMethodPatchHandle<RenderableInstance, [width: number], string[]>;
type MessageHighlightsPatchRecord = { patches: RenderPatchHandle[] };
type PatchState = typeof globalThis & {
    [MESSAGE_HIGHLIGHTS_PATCH_KEY]?: MessageHighlightsPatchRecord | true;
};

type ThemeContract = {
    fg?: ((color: string, text: string) => string) | undefined;
    getColorMode?: (() => string) | undefined;
};

type EditorHighlightPrototype = RenderablePrototype & {
    getText?: (() => string) | undefined;
};

function isObjectIdentity(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

type UnknownModuleDescriptor = Omit<PropertyDescriptor, "value"> & {
    readonly value: unknown;
};

function isUnknownModuleDescriptor(
    descriptor: PropertyDescriptor | undefined,
): descriptor is UnknownModuleDescriptor {
    return descriptor !== undefined && Object.hasOwn(descriptor, "value");
}

/* oxlint-disable antislop/no-unknown-parameters -- This is the parser boundary for a private Pi module namespace. */
function parseMessageComponent(
    module: unknown,
    exportName: "AssistantMessageComponent" | "UserMessageComponent",
): RenderablePrototype | undefined {
    if (!isObjectIdentity(module)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(module, exportName);
    if (!isUnknownModuleDescriptor(descriptor)) return undefined;
    const component = descriptor.value;
    if (
        !isObjectIdentity(component) ||
        !("prototype" in component) ||
        !isObjectIdentity(component.prototype) ||
        !("render" in component.prototype) ||
        typeof component.prototype.render !== "function"
    ) {
        return undefined;
    }
    // SAFETY: The only consumed method is callable; its private receiver signature is fixed
    // by the pinned Pi version and exercised by package integration tests.
    return component.prototype as RenderablePrototype;
}
/* oxlint-enable antislop/no-unknown-parameters */

const themeParser = {
    parse(module: unknown): HighlightTheme | undefined {
        // Pi exports its theme as a proxy whose properties throw until startup initializes it.
        // Validate the stable proxy boundary now, then resolve methods lazily during rendering.
        if (!isObjectIdentity(module) || !("theme" in module)) return undefined;
        const theme = module.theme;
        if (!isObjectIdentity(theme)) return undefined;
        // SAFETY: The object/function guard permits lazy reads of only the two optional methods.
        const contract = theme as ThemeContract;
        return {
            fg(color, text): string {
                const fg = contract.fg;
                if (typeof fg !== "function") throw new Error("Theme.fg unavailable");
                return fg.call(theme, color, text);
            },
            getColorMode(): "truecolor" | "256color" {
                const getColorMode = contract.getColorMode;
                if (typeof getColorMode !== "function") {
                    throw new Error("Theme.getColorMode unavailable");
                }
                const mode = getColorMode.call(theme);
                if (mode !== "truecolor" && mode !== "256color") {
                    throw new Error("Theme.getColorMode returned an unsupported value");
                }
                return mode;
            },
        };
    },
};

async function loadAssistantMessagePrototype(): Promise<RenderablePrototype | undefined> {
    return loadPiInternalModule("modes/interactive/components/assistant-message.js", {
        scope: SCOPE,
        feature: "AssistantMessageComponent patch",
        parse(module: unknown): RenderablePrototype | undefined {
            return parseMessageComponent(module, "AssistantMessageComponent");
        },
    });
}

async function loadUserMessagePrototype(): Promise<RenderablePrototype | undefined> {
    return loadPiInternalModule("modes/interactive/components/user-message.js", {
        scope: SCOPE,
        feature: "UserMessageComponent patch",
        parse(module: unknown): RenderablePrototype | undefined {
            return parseMessageComponent(module, "UserMessageComponent");
        },
    });
}

function getEditorPrototype(): RenderablePrototype {
    return Editor.prototype;
}

function isEditorHighlightTarget(
    value: EditorHighlightPrototype,
): value is EditorHighlightPrototype & EditorHighlightTarget {
    return typeof value.getText === "function";
}

function patchRenderablePrototype(
    prototype: RenderablePrototype,
    getStyles: HighlightStylesProvider,
): RenderPatchHandle {
    return installLinkedRenderPatch(
        prototype,
        (predecessor) =>
            function highlightedRender(this: RenderableInstance, width: number): string[] {
                return highlightMessageLines(predecessor.call(this, width), getStyles());
            },
    );
}

function patchEditorPrototype(
    prototype: RenderablePrototype,
    getStyles: HighlightStylesProvider,
): RenderPatchHandle | undefined {
    if (!isEditorHighlightTarget(prototype)) return undefined;
    return installLinkedRenderPatch(
        prototype,
        (predecessor) =>
            function highlightedEditorRender(this: RenderableInstance, width: number): string[] {
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
        parse(module: unknown): HighlightTheme | undefined {
            return themeParser.parse(module);
        },
    });
    const getStyles = () => buildHighlightStyles(theme, getConfig());
    const assistantPrototype = await loadAssistantMessagePrototype();
    const userPrototype = await loadUserMessagePrototype();
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
