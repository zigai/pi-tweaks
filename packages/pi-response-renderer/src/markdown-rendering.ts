import {
    Markdown,
    type DefaultTextStyle,
    type MarkdownOptions,
    type MarkdownTheme,
} from "@earendil-works/pi-tui";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_OSC_REGEX = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, "g");
const ANSI_CSI_REGEX = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const ANSI_SGR_REGEX = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

const fencesHiddenInstances = new WeakSet<object>();

function stripAnsi(text: string): string {
    return text.replace(ANSI_OSC_REGEX, "").replace(ANSI_CSI_REGEX, "");
}

export function stripItalicAnsi(text: string): string {
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

export function isFenceLine(line: string): boolean {
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
export type MarkdownRender = (this: Markdown, width: number) => string[];

type StyledMarkdownInstance = {
    text?: string;
    paddingX?: number;
    theme?: MarkdownTheme;
    defaultTextStyle?: DefaultTextStyle;
    options?: MarkdownOptions;
};

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

export function resolveHeadingLineTexts(
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

export function resolveHeadingPrefix(instance: Markdown): string {
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

export function collapseAssistantBlankLines(
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

export function shouldHideFences(instance: object): boolean {
    return fencesHiddenInstances.has(instance);
}

export function markFencesHidden(instance: object): void {
    fencesHiddenInstances.add(instance);
}
