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

type StyledMarkdownInstance = {
    text?: string;
    paddingX?: number;
    theme?: MarkdownTheme;
    defaultTextStyle?: DefaultTextStyle;
    options?: MarkdownOptions;
};

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

function resolveHeadingLineTexts(
    instance: Markdown,
    width: number,
    renderMarkdown: MarkdownRender,
): ReadonlySet<string> {
    const markdownInstance = instance as unknown as StyledMarkdownInstance;
    if (typeof markdownInstance.text !== "string") {
        return new Set();
    }
    if (markdownInstance.theme === undefined) {
        return new Set();
    }

    const headingSources = getLevelOneOrTwoHeadingSources(markdownInstance.text);
    if (headingSources.length === 0) {
        return new Set();
    }

    let paddingX = 0;
    if (
        typeof markdownInstance.paddingX === "number" &&
        Number.isFinite(markdownInstance.paddingX) &&
        markdownInstance.paddingX >= 0
    ) {
        paddingX = markdownInstance.paddingX;
    }

    const headingLines = new Set<string>();
    for (const headingSource of headingSources) {
        const headingMarkdown = new Markdown(
            headingSource,
            paddingX,
            0,
            markdownInstance.theme,
            markdownInstance.defaultTextStyle,
            markdownInstance.options,
        );
        for (const line of renderMarkdown.call(headingMarkdown, width)) {
            if (!isBlankRenderedLine(line)) {
                headingLines.add(normalizeRenderedLine(line));
            }
        }
    }

    return headingLines;
}

function resolveHeadingPrefix(instance: Markdown): string {
    // Level 1-2 headings render without `#`, so use their ANSI heading prefix.
    const theme = (instance as unknown as StyledMarkdownInstance).theme;
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
        const assistantModule = (await import(assistantMessagePath)) as {
            AssistantMessageComponent?: { prototype?: AssistantMessageComponentPrototype };
        };
        return assistantModule.AssistantMessageComponent?.prototype;
    } catch (error: unknown) {
        warnInternalPatchUnavailable("assistant message patch", error);
        return undefined;
    }
}

async function patchMarkdownFences(): Promise<void> {
    const state = getPatchState();
    if (state[MARKDOWN_FENCES_PATCH_KEY] === true) {
        return;
    }

    const markdownPrototype = Markdown.prototype as {
        render?: (width: number) => string[];
    };
    const originalMarkdownRender = Reflect.get(markdownPrototype, "render");
    if (typeof originalMarkdownRender !== "function") {
        warnInternalPatchUnavailable("markdown render patch");
        return;
    }
    state[MARKDOWN_FENCES_PATCH_KEY] = true;
    markdownPrototype.render = function patchedMarkdownRender(
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

    const assistantPrototype = await loadAssistantMessagePrototype();
    if (assistantPrototype === undefined) {
        return;
    }

    const originalRender = Reflect.get(assistantPrototype, "render") as
        | ((this: AssistantMessageComponentInstance, width: number) => string[])
        | undefined;
    if (typeof originalRender !== "function") {
        warnInternalPatchUnavailable("assistant render patch");
        return;
    }
    assistantPrototype.render = function patchedAssistantRender(
        this: AssistantMessageComponentInstance,
        width: number,
    ): string[] {
        return originalRender.call(this, width).map(stripItalicAnsi);
    };

    const originalUpdateContent = Reflect.get(assistantPrototype, "updateContent") as
        | ((this: AssistantMessageComponentInstance, message: unknown) => void)
        | undefined;
    if (typeof originalUpdateContent !== "function") {
        warnInternalPatchUnavailable("assistant content patch");
        return;
    }
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
