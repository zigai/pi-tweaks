import { Markdown, type Component } from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKDOWN_FENCES_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.markdown-fences-patched");
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_OSC_REGEX = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, "g");
const ANSI_CSI_REGEX = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const ANSI_SGR_REGEX = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

const fencesHiddenInstances = new WeakSet<object>();

type PatchState = typeof globalThis & {
    [MARKDOWN_FENCES_PATCH_KEY]?: boolean;
};

type AssistantMessageComponentInstance = Component & {
    contentContainer?: {
        addChild(component: Component): void;
    };
};

type AssistantMessageComponentPrototype = {
    render(this: AssistantMessageComponentInstance, width: number): string[];
    updateContent(this: AssistantMessageComponentInstance, message: unknown): void;
};

function stripAnsi(text: string): string {
    return text.replace(ANSI_OSC_REGEX, "").replace(ANSI_CSI_REGEX, "");
}

function stripItalicAnsi(text: string): string {
    return text.replace(ANSI_SGR_REGEX, (_match, params: string) => {
        let codes: string[] = [];
        if (params.length > 0) {
            codes = params.split(";").filter((code) => code.length > 0);
        }

        const filtered = codes.filter((code) => code !== "3" && code !== "23");
        if (filtered.length === 0) {
            return "";
        }
        return `\u001b[${filtered.join(";")}m`;
    });
}

function isFenceLine(line: string): boolean {
    return /^```[a-zA-Z0-9]*$/.test(stripAnsi(line).trim());
}

function shouldHideFences(instance: object): boolean {
    return fencesHiddenInstances.has(instance);
}

function markFencesHidden(instance: object): void {
    fencesHiddenInstances.add(instance);
}

function getPatchState(): PatchState {
    return globalThis as PatchState;
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

async function patchMarkdownFences(): Promise<void> {
    const state = getPatchState();
    if (state[MARKDOWN_FENCES_PATCH_KEY] === true) {
        return;
    }
    state[MARKDOWN_FENCES_PATCH_KEY] = true;

    const markdownPrototype = Markdown.prototype as {
        render(width: number): string[];
    };
    const originalMarkdownRender = Reflect.get(markdownPrototype, "render") as (
        this: Markdown,
        width: number,
    ) => string[];
    markdownPrototype.render = function patchedMarkdownRender(
        this: Markdown,
        width: number,
    ): string[] {
        const lines = originalMarkdownRender.call(this, width);
        if (!shouldHideFences(this)) {
            return lines;
        }
        return lines.filter((line) => !isFenceLine(line));
    };

    const distDir = await resolvePiDistDir();
    const assistantMessagePath = pathToFileURL(
        join(distDir, "modes/interactive/components/assistant-message.js"),
    ).href;
    const assistantModule = (await import(assistantMessagePath)) as {
        AssistantMessageComponent?: { prototype?: AssistantMessageComponentPrototype };
    };
    const assistantPrototype = assistantModule.AssistantMessageComponent?.prototype;
    if (assistantPrototype === undefined) {
        return;
    }

    const originalRender = Reflect.get(assistantPrototype, "render") as (
        this: AssistantMessageComponentInstance,
        width: number,
    ) => string[];
    assistantPrototype.render = function patchedAssistantRender(
        this: AssistantMessageComponentInstance,
        width: number,
    ): string[] {
        return originalRender.call(this, width).map(stripItalicAnsi);
    };

    const originalUpdateContent = Reflect.get(assistantPrototype, "updateContent") as (
        this: AssistantMessageComponentInstance,
        message: unknown,
    ) => void;
    assistantPrototype.updateContent = function patchedUpdateContent(
        this: AssistantMessageComponentInstance,
        message: unknown,
    ): void {
        const contentContainer = this.contentContainer;
        const originalAddChild = Reflect.get(contentContainer ?? {}, "addChild") as
            | ((
                  this: NonNullable<AssistantMessageComponentInstance["contentContainer"]>,
                  component: Component,
              ) => void)
            | undefined;

        if (contentContainer !== undefined && originalAddChild !== undefined) {
            contentContainer.addChild = function addChildWithFenceTracking(
                component: Component,
            ): void {
                if (component instanceof Markdown) {
                    markFencesHidden(component);
                }
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
}

export default async function assistantRenderingExtension(): Promise<void> {
    await patchMarkdownFences();
}
