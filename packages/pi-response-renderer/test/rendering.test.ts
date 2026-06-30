import assert from "node:assert/strict";
import { test } from "vitest";

import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import assistantRenderingExtension from "../src/index.ts";

const identity = (text: string): string => text;
const markdownTheme = {
    heading: identity,
    link: identity,
    linkUrl: identity,
    code: identity,
    codeBlock: identity,
    codeBlockBorder: identity,
    quote: identity,
    quoteBorder: identity,
    hr: identity,
    listBullet: identity,
    bold: identity,
    italic: identity,
    strikethrough: identity,
    underline: identity,
} satisfies MarkdownTheme;

await assistantRenderingExtension();

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC_REGEX = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, "g");
const CSI_REGEX = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

function stripAnsi(text: string): string {
    return text.replace(OSC_REGEX, "").replace(CSI_REGEX, "");
}

function renderPlainLines(markdown: string): string[] {
    return new Markdown(markdown, 1, 0, markdownTheme).render(120).map((line) => line.trim());
}

function renderVisibleLines(markdown: string, theme: MarkdownTheme): string[] {
    return new Markdown(markdown, 1, 0, theme).render(80).map((line) => stripAnsi(line).trim());
}

function assertHeadingKeepsParagraphGaps(
    markdownHeading: string,
    renderedHeading: string,
    theme: MarkdownTheme,
): void {
    const beforeHeading = "The summary starts with a short lead-in.";
    const afterHeading = "The next paragraph should stay visually separated.";
    const lines = renderVisibleLines(
        [beforeHeading, "", markdownHeading, "", afterHeading].join("\n"),
        theme,
    );

    assert.deepEqual(lines, [beforeHeading, "", renderedHeading, "", afterHeading]);
}

// Level 1-2 headings need style detection because Pi strips their `#` prefix.
const boldHeadingTheme: MarkdownTheme = {
    ...markdownTheme,
    heading: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

const colorHeadingTheme: MarkdownTheme = {
    ...markdownTheme,
    heading: (text: string) => `\x1b[38;5;99m${text}\x1b[39m`,
};

const inlineBoldTheme: MarkdownTheme = {
    ...markdownTheme,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

const codeColorTheme: MarkdownTheme = {
    ...markdownTheme,
    heading: (text: string) => `\x1b[38;5;99m${text}\x1b[39m`,
    code: (text: string) => `\x1b[38;5;215m${text}\x1b[39m`,
};

const colorHeadingBoldTheme: MarkdownTheme = {
    ...markdownTheme,
    heading: (text: string) => `\x1b[38;5;99m${text}\x1b[39m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

const italicTheme: MarkdownTheme = {
    ...markdownTheme,
    italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
};

test("preserves the separator before a long rendered Markdown heading", () => {
    const lines = renderPlainLines(
        [
            "The standards prefer modules that own one cohesive concept/seam.",
            "",
            "### 2. Replace string diagnostics with structured diagnostics",
        ].join("\n"),
    );

    assert.deepEqual(lines, [
        "The standards prefer modules that own one cohesive concept/seam.",
        "",
        "### 2. Replace string diagnostics with structured diagnostics",
    ]);
});

test("still collapses blank lines between plain paragraph lines", () => {
    const lines = renderPlainLines(
        ["First paragraph sentence.", "", "Second paragraph sentence."].join("\n"),
    );

    assert.deepEqual(lines, ["First paragraph sentence.", "Second paragraph sentence."]);
});

test("preserves the blank line after a rendered Markdown table", () => {
    const lines = renderVisibleLines(
        [
            "| Layer | Uniform? |",
            "|-------|----------|",
            "| Wire protocol | Yes |",
            "| Adapter import | Yes |",
            "",
            "So you're right on the architecture.",
        ].join("\n"),
        markdownTheme,
    );

    const tableBottomIndex = lines.findIndex((line) => line.startsWith("└"));
    assert.ok(tableBottomIndex >= 0, "expected a rendered table bottom border");
    assert.equal(lines[tableBottomIndex + 1], "");
    assert.equal(lines[tableBottomIndex + 2], "So you're right on the architecture.");
});

test("preserves the blank line before a rendered Markdown table", () => {
    const lines = renderVisibleLines(
        ["So the split is:", "", "| A | B |", "|---|---|", "| 1 | 2 |"].join("\n"),
        markdownTheme,
    );

    assert.equal(lines[0], "So the split is:");
    assert.equal(lines[1], "");
    assert.ok(lines[2].startsWith("┌"), "expected a rendered table top border");
});

test("preserves blanks around a styled level-2 heading without # prefix", () => {
    assertHeadingKeepsParagraphGaps(
        "## Release readiness?",
        "Release readiness?",
        boldHeadingTheme,
    );
});

test("detects color-only heading styles", () => {
    assertHeadingKeepsParagraphGaps("## Rollout status?", "Rollout status?", colorHeadingTheme);
});

test("preserves blanks around an inline-code level-2 heading without # prefix", () => {
    assertHeadingKeepsParagraphGaps(
        "## `render()` behavior?",
        "render() behavior?",
        codeColorTheme,
    );
});

test("preserves blanks around a bold level-2 heading without # prefix", () => {
    assertHeadingKeepsParagraphGaps(
        "## **API compatibility?**",
        "API compatibility?",
        colorHeadingBoldTheme,
    );
});

test("collapses blanks around a fully-bold standalone line (not a heading)", () => {
    const lines = renderVisibleLines(
        ["Intro paragraph.", "", "**Bold Title?**", "", "Body paragraph."].join("\n"),
        inlineBoldTheme,
    );

    assert.deepEqual(lines, ["Intro paragraph.", "Bold Title?", "Body paragraph."]);
});

test("does not treat a standalone inline-code line as a heading", () => {
    const lines = renderVisibleLines(
        [
            "I also saved these commands to:",
            "",
            "`examples/console-rendering/recordings/playback-commands.txt`",
            "",
            "I skipped 02 and 05 because they were intentionally not implemented.",
        ].join("\n"),
        codeColorTheme,
    );

    assert.deepEqual(lines, [
        "I also saved these commands to:",
        "",
        "examples/console-rendering/recordings/playback-commands.txt",
        "I skipped 02 and 05 because they were intentionally not implemented.",
    ]);
});

test("does not treat a paragraph with inline bold as a heading", () => {
    const lines = renderVisibleLines(
        ["A paragraph with a **bold word** inside.", "", "Next paragraph."].join("\n"),
        inlineBoldTheme,
    );

    assert.deepEqual(lines, ["A paragraph with a bold word inside.", "Next paragraph."]);
});

test("does not treat a fully-italic line as a heading (thinking trace)", () => {
    const lines = renderVisibleLines(
        [
            "First plain paragraph.",
            "",
            "*Italic standalone line.*",
            "",
            "Second plain paragraph.",
        ].join("\n"),
        italicTheme,
    );

    assert.deepEqual(lines, [
        "First plain paragraph.",
        "Italic standalone line.",
        "Second plain paragraph.",
    ]);
});
