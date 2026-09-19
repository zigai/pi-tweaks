import assert from "node:assert/strict";
import { test } from "vitest";

import { Editor, TuiMainScreen as TUI, type Terminal } from "@earendil-works/pi-tui";
import { installEditorHeightPatch } from "../src/editor-height.ts";

class FakeTerminal implements Terminal {
    columns = 80;
    rows = 20;

    get kittyProtocolActive(): boolean {
        return false;
    }

    start(): void {}

    stop(): void {}

    async drainInput(): Promise<void> {}

    write(): void {}

    moveBy(): void {}

    hideCursor(): void {}

    showCursor(): void {}

    clearLine(): void {}

    clearFromCursor(): void {}

    clearScreen(): void {}

    setTitle(): void {}

    setProgress(): void {}
}

const identityStyle = (text: string): string => text;
const editorTheme = {
    borderColor: identityStyle,
    selectList: {
        selectedPrefix: identityStyle,
        selectedText: identityStyle,
        description: identityStyle,
        scrollInfo: identityStyle,
        noMatch: identityStyle,
    },
};

test("unlimited editor height expands to fill available screen height without pushing bottom border off-screen", () => {
    const handle = installEditorHeightPatch({
        editorMaxHeight: "unlimited",
        showEditorOverflowIndicators: true,
    });

    try {
        const tui = new TUI(new FakeTerminal());
        const editor = new Editor(tui, editorTheme);
        const longText = Array.from({ length: 40 }, (_v, i) => `Line ${i + 1}`).join("\n");
        editor.setText(longText);

        const lines = editor.render(80);

        // Fits within terminal rows (20) keeping bottom border visible on screen
        assert.equal(lines.length, 19);
        assert.equal(lines.at(-1)?.startsWith("─"), true);
    } finally {
        handle.dispose();
    }
});

test("numeric editor height limits prompt editor lines", () => {
    const handle = installEditorHeightPatch({
        editorMaxHeight: 10,
        showEditorOverflowIndicators: true,
    });

    try {
        const tui = new TUI(new FakeTerminal());
        const editor = new Editor(tui, editorTheme);
        const longText = Array.from({ length: 40 }, (_v, i) => `Line ${i + 1}`).join("\n");
        editor.setText(longText);

        const lines = editor.render(80);

        assert.equal(lines.length, 13);
        assert.equal(lines.at(-1)?.startsWith("─"), true);
    } finally {
        handle.dispose();
    }
});
