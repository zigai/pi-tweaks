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

type AssistantMessageComponentInstance = Component & {
    contentContainer?: { addChild(component: Component): void };
};

type AssistantMessageComponentPrototype = {
    render(this: AssistantMessageComponentInstance, width: number): string[];
    updateContent(this: AssistantMessageComponentInstance, message: unknown): void;
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
    assistantRenderPatch?: AssistantRenderPatchHandle;
    assistantPrototype?: AssistantMessageComponentPrototype;
    originalAssistantUpdateContent?: AssistantMessageComponentPrototype["updateContent"];
    patchedAssistantUpdateContent?: AssistantMessageComponentPrototype["updateContent"];
};

type PatchState = typeof globalThis & {
    [MARKDOWN_FENCES_PATCH_KEY]?: MarkdownFencesPatchRecord | true;
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function parseAssistantPrototype(module: unknown): AssistantMessageComponentPrototype | undefined {
    const component = getUnknownProperty(module, "AssistantMessageComponent");
    const prototype = getUnknownProperty(component, "prototype");
    if (
        (typeof prototype === "object" || typeof prototype === "function") &&
        prototype !== null &&
        typeof getUnknownProperty(prototype, "render") === "function" &&
        typeof getUnknownProperty(prototype, "updateContent") === "function"
    ) {
        return prototype as AssistantMessageComponentPrototype;
    }
    return undefined;
}

function restoreMarkdownFencesPatch(): void {
    const state: PatchState = globalThis;
    const patch = state[MARKDOWN_FENCES_PATCH_KEY];
    if (patch === undefined || patch === true) return;

    if (patch.markdownPrototype.render === patch.patchedMarkdownRender) {
        patch.markdownPrototype.render = patch.originalMarkdownRender;
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
    };
    state[MARKDOWN_FENCES_PATCH_KEY] = patch;

    const assistantPrototype = await loadPiInternalModule(
        "modes/interactive/components/assistant-message.js",
        { scope: SCOPE, feature: "assistant message patch", parse: parseAssistantPrototype },
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

    const originalUpdateContentValue = getUnknownProperty(assistantPrototype, "updateContent");
    if (typeof originalUpdateContentValue !== "function") return;
    // SAFETY: parseAssistantPrototype verified this Pi prototype method's callable contract.
    const originalUpdateContent =
        originalUpdateContentValue as AssistantMessageComponentPrototype["updateContent"];
    const patchedAssistantUpdateContent = function (
        this: AssistantMessageComponentInstance,
        message: unknown,
    ): void {
        const contentContainer = this.contentContainer;
        const originalAddChild = getUnknownProperty(contentContainer, "addChild");
        if (contentContainer !== undefined && typeof originalAddChild === "function") {
            Reflect.set(
                contentContainer,
                "addChild",
                function (
                    this: NonNullable<AssistantMessageComponentInstance["contentContainer"]>,
                    component: Component,
                ): void {
                    if (component instanceof Markdown) markFencesHidden(component);
                    Reflect.apply(originalAddChild, this, [component]);
                },
            );
        }
        try {
            originalUpdateContent.call(this, message);
        } finally {
            if (contentContainer !== undefined && typeof originalAddChild === "function") {
                Reflect.set(contentContainer, "addChild", originalAddChild);
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
