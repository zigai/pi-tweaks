import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, type Component } from "@earendil-works/pi-tui";
import {
    installLinkedRenderPatch,
    loadPiInternalModule,
    warnPiInternalPatchUnavailable,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

import {
    collapseAssistantBlankLines,
    isFenceLine,
    markFencesHidden,
    resolveHeadingLineTexts,
    resolveHeadingPrefix,
    shouldHideFences,
    stripItalicAnsi,
    type MarkdownRender,
} from "./markdown-rendering.ts";

const MARKDOWN_FENCES_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.markdown-fences-patched");
const SCOPE = "pi-response-renderer";

type ForeignMarkdownPatch = {
    component: Component;
    originalRender: Component["render"];
    patchedRender: Component["render"];
};

function hasForeignMarkdownContract(component: Component): boolean {
    return (
        "setText" in component &&
        typeof component.setText === "function" &&
        "invalidate" in component &&
        typeof component.invalidate === "function" &&
        "text" in component &&
        "theme" in component
    );
}

function hideForeignMarkdownFences(patch: MarkdownFencesPatchRecord, component: Component): void {
    const foreignMarkdownPatches = patch.foreignMarkdownPatches;
    if (foreignMarkdownPatches === undefined) return;
    if (foreignMarkdownPatches.some((entry) => entry.component === component)) return;

    // Stored for identity-safe restoration and always invoked with its original receiver.
    // oxlint-disable-next-line typescript/unbound-method
    const originalRender = component.render;
    const patchedRender = function renderWithoutFences(width: number): string[] {
        const lines = originalRender.call(component, width).filter((line) => !isFenceLine(line));
        return collapseAssistantBlankLines(lines, "", new Set());
    };
    component.render = patchedRender;
    foreignMarkdownPatches.push({ component, originalRender, patchedRender });
}

function hideAssistantMarkdownFences(patch: MarkdownFencesPatchRecord, component: Component): void {
    if (component instanceof Markdown) {
        markFencesHidden(component);
        return;
    }
    if (hasForeignMarkdownContract(component)) hideForeignMarkdownFences(patch, component);
}

type AssistantContentContainer = {
    addChild: (this: AssistantContentContainer, component: Component) => void;
};
type AssistantMessageComponentInstance = Component & {
    contentContainer?: AssistantContentContainer;
};

type AssistantMessageComponentPrototype = {
    render: (this: AssistantMessageComponentInstance, width: number) => string[];
    updateContent: (this: AssistantMessageComponentInstance, message: AssistantMessage) => void;
};

type MarkdownPrototype = { render?: MarkdownRender };
type AssistantRenderPatchHandle = LinkedMethodPatchHandle<
    AssistantMessageComponentInstance,
    [width: number],
    string[]
>;

type MarkdownFencesPatchRecord = {
    markdownPrototype: MarkdownPrototype;
    originalMarkdownRender: MarkdownRender;
    patchedMarkdownRender: MarkdownRender;
    foreignMarkdownPatches?: ForeignMarkdownPatch[];
    assistantRenderPatch?: AssistantRenderPatchHandle;
    assistantPrototype?: AssistantMessageComponentPrototype;
    originalAssistantUpdateContent?: AssistantMessageComponentPrototype["updateContent"];
    patchedAssistantUpdateContent?: AssistantMessageComponentPrototype["updateContent"];
};

type PatchState = typeof globalThis & {
    [MARKDOWN_FENCES_PATCH_KEY]?: MarkdownFencesPatchRecord | true;
};

function isObjectIdentity(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

const assistantPrototypeParser = {
    parse: (module: unknown): AssistantMessageComponentPrototype | undefined => {
        if (!isObjectIdentity(module) || !("AssistantMessageComponent" in module)) {
            return undefined;
        }
        const component = module.AssistantMessageComponent;
        if (!isObjectIdentity(component) || !("prototype" in component)) return undefined;
        const prototype = component.prototype;
        if (
            !isObjectIdentity(prototype) ||
            !("render" in prototype) ||
            typeof prototype.render !== "function" ||
            !("updateContent" in prototype) ||
            typeof prototype.updateContent !== "function"
        ) {
            return undefined;
        }
        // SAFETY: Both consumed lifecycle methods are callable. Their private Pi parameter
        // signatures cannot be reflected and are fixed by the pinned Pi package version.
        return prototype as AssistantMessageComponentPrototype;
    },
};

function restoreMarkdownFencesPatch(): void {
    const state: PatchState = globalThis;
    const patch = state[MARKDOWN_FENCES_PATCH_KEY];
    if (patch === undefined || patch === true) return;

    if (patch.markdownPrototype.render === patch.patchedMarkdownRender) {
        patch.markdownPrototype.render = patch.originalMarkdownRender;
    }
    const foreignMarkdownPatches = patch.foreignMarkdownPatches;
    if (foreignMarkdownPatches !== undefined) {
        for (const foreignPatch of foreignMarkdownPatches) {
            if (foreignPatch.component.render === foreignPatch.patchedRender) {
                foreignPatch.component.render = foreignPatch.originalRender;
            }
        }
        foreignMarkdownPatches.length = 0;
    }
    patch.assistantRenderPatch?.dispose();
    if (
        patch.assistantPrototype !== undefined &&
        patch.originalAssistantUpdateContent !== undefined &&
        patch.patchedAssistantUpdateContent !== undefined &&
        patch.assistantPrototype.updateContent === patch.patchedAssistantUpdateContent
    ) {
        patch.assistantPrototype.updateContent = patch.originalAssistantUpdateContent;
    }
    delete state[MARKDOWN_FENCES_PATCH_KEY];
}

async function patchMarkdownFences(): Promise<void> {
    const state: PatchState = globalThis;
    if (state[MARKDOWN_FENCES_PATCH_KEY] !== undefined) return;

    const markdownPrototype: MarkdownPrototype = Markdown.prototype;
    const originalMarkdownRender = markdownPrototype.render;
    if (typeof originalMarkdownRender !== "function") {
        warnPiInternalPatchUnavailable(SCOPE, "markdown render patch");
        return;
    }
    const patchedMarkdownRender: MarkdownRender = function (this: Markdown, width: number) {
        let lines = originalMarkdownRender.call(this, width);
        if (shouldHideFences(this)) lines = lines.filter((line) => !isFenceLine(line));
        return collapseAssistantBlankLines(
            lines,
            resolveHeadingPrefix(this),
            resolveHeadingLineTexts(this, width, originalMarkdownRender),
        );
    };
    markdownPrototype.render = patchedMarkdownRender;
    const patch: MarkdownFencesPatchRecord = {
        markdownPrototype,
        originalMarkdownRender,
        patchedMarkdownRender,
        foreignMarkdownPatches: [],
    };
    state[MARKDOWN_FENCES_PATCH_KEY] = patch;

    const assistantPrototype = await loadPiInternalModule(
        "modes/interactive/components/assistant-message.js",
        { scope: SCOPE, feature: "assistant message patch", parse: assistantPrototypeParser.parse },
    );
    if (assistantPrototype === undefined) return;

    patch.assistantRenderPatch = installLinkedRenderPatch(
        assistantPrototype,
        (predecessor) =>
            function assistantRenderWithoutItalics(
                this: AssistantMessageComponentInstance,
                width: number,
            ): string[] {
                return predecessor.call(this, width).map(stripItalicAnsi);
            },
    );
    patch.assistantPrototype = assistantPrototype;

    const originalUpdateContent = assistantPrototype.updateContent;
    const patchedAssistantUpdateContent = function (
        this: AssistantMessageComponentInstance,
        message: AssistantMessage,
    ): void {
        const contentContainer = this.contentContainer;
        const originalAddChild = contentContainer?.addChild;
        if (contentContainer !== undefined && originalAddChild !== undefined) {
            contentContainer.addChild = function (
                this: NonNullable<AssistantMessageComponentInstance["contentContainer"]>,
                component: Component,
            ): void {
                hideAssistantMarkdownFences(patch, component);
                originalAddChild.call(this, component);
            };
        }
        try {
            originalUpdateContent.call(this, message);
        } finally {
            if (contentContainer !== undefined && originalAddChild !== undefined) {
                contentContainer.addChild = originalAddChild;
            }
        }
    };
    assistantPrototype.updateContent = patchedAssistantUpdateContent;
    patch.originalAssistantUpdateContent = originalUpdateContent;
    patch.patchedAssistantUpdateContent = patchedAssistantUpdateContent;
}

export default async function assistantRenderingExtension(pi?: ExtensionAPI): Promise<void> {
    await patchMarkdownFences();
    pi?.on("session_shutdown", restoreMarkdownFencesPatch);
}
