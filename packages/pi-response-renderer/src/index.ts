import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    Markdown,
    type Component,
    type DefaultTextStyle,
    type MarkdownOptions,
    type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKDOWN_FENCES_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.markdown-fences-patched");
const RENDER_PATCH_PREDECESSOR_KEY = Symbol.for("zigai.pi-tweaks.render-patch-predecessor");
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_OSC_REGEX = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, "g");
const ANSI_CSI_REGEX = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const ANSI_SGR_REGEX = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

const fencesHiddenInstances = new WeakSet<object>();

type PatchState = typeof globalThis & {
    [MARKDOWN_FENCES_PATCH_KEY]?: MarkdownFencesPatchRecord | true;
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

type RenderMethod<Instance extends object> = (this: Instance, width: number) => string[];

type LinkedRenderMethod<Instance extends object> = RenderMethod<Instance> & {
    [RENDER_PATCH_PREDECESSOR_KEY]?: RenderMethod<Instance>;
};

function getRenderPredecessor<Instance extends object>(
    render: RenderMethod<Instance>,
): RenderMethod<Instance> | undefined {
    const predecessor: unknown = Reflect.get(render, RENDER_PATCH_PREDECESSOR_KEY);
    if (typeof predecessor !== "function") return undefined;
    // SAFETY: Render wrappers in this repository store only the same prototype method
    // signature under this private symbol; the runtime check verifies it is callable.
    return predecessor as RenderMethod<Instance>;
}

function removeLinkedRenderPatch<Instance extends object>(
    prototype: { render: RenderMethod<Instance> },
    patchedRender: LinkedRenderMethod<Instance>,
): void {
    const predecessor = getRenderPredecessor(patchedRender);
    if (predecessor === undefined) return;

    if (prototype.render === patchedRender) {
        prototype.render = predecessor;
        return;
    }

    const visited = new Set<RenderMethod<Instance>>();
    let current = prototype.render;
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
    return /^`{3,}[^`]*$/.test(stripAnsi(line).trim());
}

function isBlankRenderedLine(line: string): boolean {
    return stripAnsi(line).trim().length === 0;
}

function isIntroLine(line: string): boolean {
    return stripAnsi(line).trimEnd().endsWith(":");
}

function isIntroducedBlockLine(line: string): boolean {
    const plainLine = stripAnsi(line);
    const trimmedStart = plainLine.trimStart();

    return (
        /^[-*+]\s+/.test(trimmedStart) ||
        /^\d+[.)]\s+/.test(trimmedStart) ||
        trimmedStart.startsWith("```") ||
        trimmedStart.startsWith("|") ||
        /^ {2,}\S/.test(plainLine)
    );
}

function isMarkdownHeadingLine(line: string): boolean {
    return /^#{1,6}\s+\S/.test(stripAnsi(line).trimStart());
}

function isTableLine(line: string): boolean {
    // Rendered Markdown tables start with box-drawing characters.
    return /^[\u2500-\u257F]/.test(stripAnsi(line).trimStart());
}

type MarkdownRender = (this: Markdown, width: number) => string[];

type MarkdownPrototype = {
    render?: MarkdownRender;
};

type MarkdownFencesPatchRecord = {
    markdownPrototype: MarkdownPrototype;
    originalMarkdownRender: MarkdownRender;
    patchedMarkdownRender: MarkdownRender;
    assistantPrototype?: AssistantMessageComponentPrototype;
    originalAssistantRender?: AssistantMessageComponentPrototype["render"];
    patchedAssistantRender?: LinkedRenderMethod<AssistantMessageComponentInstance>;
    originalAssistantUpdateContent?: AssistantMessageComponentPrototype["updateContent"];
    patchedAssistantUpdateContent?: AssistantMessageComponentPrototype["updateContent"];
};

type StyledMarkdownInstance = {
    text?: string;
    paddingX?: number;
    theme?: MarkdownTheme;
    defaultTextStyle?: DefaultTextStyle;
    options?: MarkdownOptions;
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function getStyledMarkdownInstance(instance: Markdown): StyledMarkdownInstance {
    // SAFETY: Markdown is the Pi TUI instance this adapter patches; its documented
    // rendering fields are read only as optional values, but the dependency does not export them.
    const internals: unknown = instance;
    return internals as StyledMarkdownInstance;
}

type HeadingLineTextsCache = {
    readonly text: string;
    readonly width: number;
    readonly paddingX: number;
    readonly theme: MarkdownTheme;
    readonly defaultTextStyle: DefaultTextStyle | undefined;
    readonly options: MarkdownOptions | undefined;
    readonly value: ReadonlySet<string>;
};

const EMPTY_HEADING_LINE_TEXTS: ReadonlySet<string> = new Set();
const headingLineTextsByMarkdown = new WeakMap<object, HeadingLineTextsCache>();

function getStylePrefix(styleFn: (text: string) => string): string {
    const sentinel = "\u0000";
    const styled = styleFn(sentinel);
    const sentinelIndex = styled.indexOf(sentinel);
    if (sentinelIndex >= 0) {
        return styled.slice(0, sentinelIndex);
    }
    return "";
}

function normalizeRenderedLine(line: string): string {
    return stripAnsi(line).trim();
}

function isAtxLevelOneOrTwoHeadingLine(line: string): boolean {
    return /^ {0,3}#{1,2}(?!#)(?:[ \t]+|$)/.test(line);
}

function getFenceSequence(line: string): string | undefined {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (match === null) {
        return undefined;
    }
    return match[1];
}

function getLevelOneOrTwoHeadingSources(markdown: string): string[] {
    const headings: string[] = [];
    let fenceSequence: string | undefined;

    for (const line of markdown.split(/\r?\n/)) {
        const nextFenceSequence = getFenceSequence(line);
        if (nextFenceSequence !== undefined) {
            if (fenceSequence === undefined) {
                fenceSequence = nextFenceSequence;
                continue;
            }

            const fenceCharacter = fenceSequence.at(0);
            if (
                fenceCharacter !== undefined &&
                nextFenceSequence.startsWith(fenceCharacter) &&
                nextFenceSequence.length >= fenceSequence.length
            ) {
                fenceSequence = undefined;
            }
            continue;
        }

        if (fenceSequence !== undefined) {
            continue;
        }

        if (isAtxLevelOneOrTwoHeadingLine(line)) {
            headings.push(line);
        }
    }

    return headings;
}

function markdownPaddingX(markdownInstance: StyledMarkdownInstance): number {
    if (
        typeof markdownInstance.paddingX === "number" &&
        Number.isFinite(markdownInstance.paddingX) &&
        markdownInstance.paddingX >= 0
    ) {
        return markdownInstance.paddingX;
    }
    return 0;
}

function cacheMatchesHeadingRenderInputs(
    cache: HeadingLineTextsCache,
    markdownInstance: StyledMarkdownInstance,
    text: string,
    width: number,
    paddingX: number,
    theme: MarkdownTheme,
): boolean {
    return (
        cache.text === text &&
        cache.width === width &&
        cache.paddingX === paddingX &&
        cache.theme === theme &&
        cache.defaultTextStyle === markdownInstance.defaultTextStyle &&
        cache.options === markdownInstance.options
    );
}

function cacheHeadingLineTexts(
    instance: Markdown,
    markdownInstance: StyledMarkdownInstance,
    text: string,
    width: number,
    paddingX: number,
    theme: MarkdownTheme,
    value: ReadonlySet<string>,
): ReadonlySet<string> {
    headingLineTextsByMarkdown.set(instance, {
        text,
        width,
        paddingX,
        theme,
        defaultTextStyle: markdownInstance.defaultTextStyle,
        options: markdownInstance.options,
        value,
    });
    return value;
}

function resolveHeadingLineTexts(
    instance: Markdown,
    width: number,
    renderMarkdown: MarkdownRender,
): ReadonlySet<string> {
    const markdownInstance = getStyledMarkdownInstance(instance);
    const text = markdownInstance.text;
    if (typeof text !== "string") {
        return EMPTY_HEADING_LINE_TEXTS;
    }
    const theme = markdownInstance.theme;
    if (theme === undefined) {
        return EMPTY_HEADING_LINE_TEXTS;
    }
    const paddingX = markdownPaddingX(markdownInstance);
    const cached = headingLineTextsByMarkdown.get(instance);
    if (
        cached !== undefined &&
        cacheMatchesHeadingRenderInputs(cached, markdownInstance, text, width, paddingX, theme)
    ) {
        return cached.value;
    }

    const headingSources = getLevelOneOrTwoHeadingSources(text);
    if (headingSources.length === 0) {
        return cacheHeadingLineTexts(
            instance,
            markdownInstance,
            text,
            width,
            paddingX,
            theme,
            EMPTY_HEADING_LINE_TEXTS,
        );
    }

    const headingLines = new Set<string>();
    for (const headingSource of headingSources) {
        const headingMarkdown = new Markdown(
            headingSource,
            paddingX,
            0,
            theme,
            markdownInstance.defaultTextStyle,
            markdownInstance.options,
        );
        for (const line of renderMarkdown.call(headingMarkdown, width)) {
            if (!isBlankRenderedLine(line)) {
                headingLines.add(normalizeRenderedLine(line));
            }
        }
    }

    return cacheHeadingLineTexts(
        instance,
        markdownInstance,
        text,
        width,
        paddingX,
        theme,
        headingLines,
    );
}

function resolveHeadingPrefix(instance: Markdown): string {
    // Level 1-2 headings render without `#`, so use their ANSI heading prefix.
    const theme = getStyledMarkdownInstance(instance).theme;
    if (typeof theme?.heading !== "function") {
        return "";
    }
    return getStylePrefix(theme.heading);
}

function isRenderedHeadingLine(
    line: string,
    headingPrefix: string,
    headingLineTexts: ReadonlySet<string>,
): boolean {
    if (headingPrefix.length > 0 && line.trimStart().startsWith(headingPrefix)) {
        return true;
    }
    return headingLineTexts.has(normalizeRenderedLine(line));
}

function isMicroHeadingLine(
    line: string,
    headingPrefix: string,
    headingLineTexts: ReadonlySet<string>,
): boolean {
    const text = stripAnsi(line).trim();

    return (
        text.length > 0 &&
        text.length <= 48 &&
        !isMarkdownHeadingLine(line) &&
        !isRenderedHeadingLine(line, headingPrefix, headingLineTexts) &&
        !isTableLine(line) &&
        !/[.!?;:]$/.test(text) &&
        !/^[-*+]\s+/.test(text) &&
        !/^\d+[.)]\s+/.test(text) &&
        !text.startsWith("|") &&
        !text.startsWith("```")
    );
}

function isPlainParagraphLine(
    line: string,
    headingPrefix: string,
    headingLineTexts: ReadonlySet<string>,
): boolean {
    return (
        !isBlankRenderedLine(line) &&
        !isMarkdownHeadingLine(line) &&
        !isRenderedHeadingLine(line, headingPrefix, headingLineTexts) &&
        !isTableLine(line) &&
        !isMicroHeadingLine(line, headingPrefix, headingLineTexts) &&
        !isIntroLine(line) &&
        !isIntroducedBlockLine(line)
    );
}

function shouldCollapseBlankLine(
    lines: string[],
    index: number,
    headingPrefix: string,
    headingLineTexts: ReadonlySet<string>,
): boolean {
    const previousLine = lines[index - 1];
    const nextLine = lines[index + 1];
    if (previousLine === undefined || nextLine === undefined) {
        return false;
    }

    if (isIntroLine(previousLine) && isIntroducedBlockLine(nextLine)) {
        return true;
    }

    return (
        isPlainParagraphLine(previousLine, headingPrefix, headingLineTexts) &&
        isPlainParagraphLine(nextLine, headingPrefix, headingLineTexts)
    );
}

function collapseAssistantBlankLines(
    lines: string[],
    headingPrefix: string,
    headingLineTexts: ReadonlySet<string>,
): string[] {
    return lines.filter((line, index) => {
        if (!isBlankRenderedLine(line)) {
            return true;
        }

        return !shouldCollapseBlankLine(lines, index, headingPrefix, headingLineTexts);
    });
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

function restoreMarkdownFencesPatch(): void {
    const state = getPatchState();
    const patch = state[MARKDOWN_FENCES_PATCH_KEY];
    if (patch === undefined || patch === true) {
        return;
    }

    if (patch.markdownPrototype.render === patch.patchedMarkdownRender) {
        patch.markdownPrototype.render = patch.originalMarkdownRender;
    }

    if (patch.assistantPrototype !== undefined && patch.patchedAssistantRender !== undefined) {
        removeLinkedRenderPatch(patch.assistantPrototype, patch.patchedAssistantRender);
    }

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
        `[pi-response-renderer] ${feature} unavailable; Pi internals may have changed${suffix}`,
    );
}

async function loadAssistantMessagePrototype(): Promise<
    AssistantMessageComponentPrototype | undefined
> {
    try {
        const distDir = await resolvePiDistDir();
        const assistantMessagePath = pathToFileURL(
            join(distDir, "modes/interactive/components/assistant-message.js"),
        ).href;
        const assistantModule: unknown = (await import(assistantMessagePath)) as unknown;
        const component = getUnknownProperty(assistantModule, "AssistantMessageComponent");
        const prototype = getUnknownProperty(component, "prototype");
        if (
            (typeof prototype === "object" || typeof prototype === "function") &&
            prototype !== null &&
            typeof getUnknownProperty(prototype, "render") === "function" &&
            typeof getUnknownProperty(prototype, "updateContent") === "function"
        ) {
            // SAFETY: This dynamic Pi-module adapter verifies both methods that make up
            // the narrow assistant-message patch seam before exposing it.
            return prototype as AssistantMessageComponentPrototype;
        }
        warnInternalPatchUnavailable("assistant message patch");
        return undefined;
    } catch (error: unknown) {
        warnInternalPatchUnavailable("assistant message patch", error);
        return undefined;
    }
}

async function patchMarkdownFences(): Promise<void> {
    const state = getPatchState();
    if (state[MARKDOWN_FENCES_PATCH_KEY] !== undefined) {
        return;
    }

    const markdownPrototype: MarkdownPrototype = Markdown.prototype;
    const originalMarkdownRender = Reflect.get(markdownPrototype, "render");
    if (typeof originalMarkdownRender !== "function") {
        warnInternalPatchUnavailable("markdown render patch");
        return;
    }
    const patchedMarkdownRender = function patchedMarkdownRender(
        this: Markdown,
        width: number,
    ): string[] {
        let lines = originalMarkdownRender.call(this, width);
        if (shouldHideFences(this)) {
            lines = lines.filter((line) => !isFenceLine(line));
        }
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

    const assistantPrototype = await loadAssistantMessagePrototype();
    if (assistantPrototype === undefined) {
        return;
    }

    const originalRenderValue: unknown = Reflect.get(assistantPrototype, "render") as unknown;
    if (typeof originalRenderValue !== "function") {
        warnInternalPatchUnavailable("assistant render patch");
        return;
    }
    // SAFETY: The immediately preceding guard proves the private assistant render seam is callable.
    const originalRender = originalRenderValue as (
        this: AssistantMessageComponentInstance,
        width: number,
    ) => string[];
    const patchedAssistantRender: LinkedRenderMethod<AssistantMessageComponentInstance> =
        function patchedAssistantRender(
            this: AssistantMessageComponentInstance,
            width: number,
        ): string[] {
            const predecessor = getRenderPredecessor(patchedAssistantRender) ?? originalRender;
            return predecessor.call(this, width).map(stripItalicAnsi);
        };
    patchedAssistantRender[RENDER_PATCH_PREDECESSOR_KEY] = originalRender;
    assistantPrototype.render = patchedAssistantRender;
    patch.assistantPrototype = assistantPrototype;
    patch.originalAssistantRender = originalRender;
    patch.patchedAssistantRender = patchedAssistantRender;

    const originalUpdateContentValue: unknown = Reflect.get(
        assistantPrototype,
        "updateContent",
    ) as unknown;
    if (typeof originalUpdateContentValue !== "function") {
        warnInternalPatchUnavailable("assistant content patch");
        return;
    }
    // SAFETY: The immediately preceding guard proves the private assistant update seam is callable.
    const originalUpdateContent = originalUpdateContentValue as (
        this: AssistantMessageComponentInstance,
        message: unknown,
    ) => void;
    const patchedAssistantUpdateContent = function patchedUpdateContent(
        this: AssistantMessageComponentInstance,
        message: unknown,
    ): void {
        const contentContainer = this.contentContainer;
        const originalAddChildValue: unknown = Reflect.get(
            contentContainer ?? {},
            "addChild",
        ) as unknown;
        let originalAddChild:
            | ((
                  this: NonNullable<AssistantMessageComponentInstance["contentContainer"]>,
                  component: Component,
              ) => void)
            | undefined;
        if (typeof originalAddChildValue === "function") {
            // SAFETY: The guarded content-container adapter verifies addChild is callable
            // before restoring it with the narrow method signature used by this patch.
            originalAddChild = originalAddChildValue as (
                this: NonNullable<AssistantMessageComponentInstance["contentContainer"]>,
                component: Component,
            ) => void;
        }

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
    assistantPrototype.updateContent = patchedAssistantUpdateContent;

    patch.originalAssistantUpdateContent = originalUpdateContent;
    patch.patchedAssistantUpdateContent = patchedAssistantUpdateContent;
}

export default async function assistantRenderingExtension(pi?: ExtensionAPI): Promise<void> {
    await patchMarkdownFences();
    pi?.on("session_shutdown", () => {
        restoreMarkdownFencesPatch();
    });
}
