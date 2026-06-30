import assert from "node:assert/strict";
import { test } from "vitest";

import { highlightMessageLine, type HighlightStyles } from "../src/highlight-text.ts";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const styles: HighlightStyles = {
    url: "<url>",
    filepath: "<path>",
};

function readEscapeSequence(text: string, start: number): string {
    const introducer = text[start + 1];
    if (introducer === undefined) return text.slice(start, start + 1);

    if (introducer === "[") {
        for (let index = start + 2; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            if (code >= 0x40 && code <= 0x7e) return text.slice(start, index + 1);
        }
        return text.slice(start);
    }

    if (introducer === "]") {
        const belIndex = text.indexOf(BEL, start + 2);
        if (belIndex === -1) return text.slice(start);
        return text.slice(start, belIndex + BEL.length);
    }

    return text.slice(start, start + 2);
}

function stripAnsi(text: string): string {
    const output: string[] = [];
    let index = 0;
    while (index < text.length) {
        if (text[index] === ESC) {
            index += readEscapeSequence(text, index).length;
            continue;
        }
        output.push(text[index] ?? "");
        index += 1;
    }
    return output.join("").replace(/<url>|<path>/g, "");
}

test("highlights URLs and file paths without changing visible text", () => {
    const line = "Open https://example.com/docs and packages/pi-footer/src/index.ts.";
    const highlighted = highlightMessageLine(line, styles);

    assert.equal(stripAnsi(highlighted), line);
    assert.equal(highlighted.includes(`<url>https://example.com/docs${ESC}[39m`), true);
    assert.equal(highlighted.includes(`<path>packages/pi-footer/src/index.ts${ESC}[39m.`), true);
});

test("highlights common bare filenames", () => {
    const line = "Edit README.md and package.json:12 next.";
    const highlighted = highlightMessageLine(line, styles);

    assert.equal(stripAnsi(highlighted), line);
    assert.equal(highlighted.includes(`<path>README.md${ESC}[39m`), true);
    assert.equal(highlighted.includes(`<path>package.json:12${ESC}[39m`), true);
});

test("does not highlight slash-separated prose as a file path", () => {
    const lines = [
        "Not before — I had only covered the configured/current extensions",
        "alpha/beta/gamma",
    ];

    for (const line of lines) {
        const highlighted = highlightMessageLine(line, styles);

        assert.equal(highlighted, line);
    }
});

test("does not highlight path-like text inside a URL twice", () => {
    const highlighted = highlightMessageLine("See https://example.com/src/index.ts", styles);

    assert.equal((highlighted.match(/<url>/g) ?? []).length, 1);
    assert.equal((highlighted.match(/<path>/g) ?? []).length, 0);
});

test("restores the previous foreground after a highlighted path", () => {
    const dim = `${ESC}[38;5;8m`;
    const line = `${dim}Read src/config.ts next${ESC}[39m`;
    const highlighted = highlightMessageLine(line, styles);

    assert.equal(stripAnsi(highlighted), "Read src/config.ts next");
    assert.equal(highlighted.includes(`<path>src/config.ts${ESC}[38;5;8m next`), true);
});

test("ignores URLs inside OSC control sequences", () => {
    const line = `${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL} and ./local/file.ts`;
    const highlighted = highlightMessageLine(line, styles);

    assert.equal(stripAnsi(highlighted), "link and ./local/file.ts");
    assert.equal(highlighted.includes("<url>"), false);
    assert.equal(highlighted.includes(`<path>./local/file.ts${ESC}[39m`), true);
});
