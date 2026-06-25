import assert from "node:assert/strict";
import test from "node:test";

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

function renderPlainLines(markdown: string): string[] {
    return new Markdown(markdown, 1, 0, markdownTheme).render(120).map((line) => line.trim());
}

void test("preserves the separator before a long rendered Markdown heading", () => {
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

void test("still collapses blank lines between plain paragraph lines", () => {
    const lines = renderPlainLines(
        ["First paragraph sentence.", "", "Second paragraph sentence."].join("\n"),
    );

    assert.deepEqual(lines, ["First paragraph sentence.", "Second paragraph sentence."]);
});
