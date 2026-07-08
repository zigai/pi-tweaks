import assert from "node:assert/strict";
import { test } from "vitest";

import { buildHighlightStyles, type HighlightTheme } from "../src/highlight-styles.ts";
import {
    DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG,
    type MessageHighlightsConfig,
} from "../src/settings.ts";

const ESC = String.fromCharCode(0x1b);

function theme(colorMode: "truecolor" | "256color" = "truecolor"): HighlightTheme {
    return {
        fg(color, text): string {
            return `<${color}>${text}</${color}>`;
        },
        getColorMode(): "truecolor" | "256color" {
            return colorMode;
        },
    };
}

test("buildHighlightStyles defaults URLs to the original blue", () => {
    const styles = buildHighlightStyles(undefined, DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG);

    assert.equal(styles.url, `${ESC}[38;5;117m`);
    assert.equal(styles.filepath, "");
});

test("buildHighlightStyles resolves URL theme colors from the active theme", () => {
    const config: MessageHighlightsConfig = {
        urlColor: { kind: "theme", color: "mdLink" },
    };
    const styles = buildHighlightStyles(theme(), config);

    assert.equal(styles.url, "<mdLink>");
    assert.equal(styles.filepath, "<accent>");
});

test("buildHighlightStyles renders explicit hex in the active color mode", () => {
    const config: MessageHighlightsConfig = {
        urlColor: { kind: "hex", color: "#87d7ff" },
    };

    assert.equal(buildHighlightStyles(theme("truecolor"), config).url, `${ESC}[38;2;135;215;255m`);
    assert.equal(buildHighlightStyles(theme("256color"), config).url, `${ESC}[38;5;117m`);
});

test("buildHighlightStyles can disable URL coloring", () => {
    const config: MessageHighlightsConfig = {
        urlColor: { kind: "none" },
    };
    const styles = buildHighlightStyles(theme(), config);

    assert.equal(styles.url, "");
    assert.equal(styles.filepath, "<accent>");
});

test("buildHighlightStyles tolerates Pi theme access before initialization", () => {
    const uninitializedTheme: HighlightTheme = {
        fg(): string {
            throw new Error("Theme not initialized. Call initTheme() first.");
        },
        getColorMode(): "truecolor" | "256color" {
            throw new Error("Theme not initialized. Call initTheme() first.");
        },
    };

    const defaultStyles = buildHighlightStyles(
        uninitializedTheme,
        DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG,
    );

    assert.equal(defaultStyles.url, `${ESC}[38;5;117m`);
    assert.equal(defaultStyles.filepath, "");
    assert.equal(
        buildHighlightStyles(uninitializedTheme, {
            urlColor: { kind: "theme", color: "mdLink" },
        }).url,
        "",
    );
});
