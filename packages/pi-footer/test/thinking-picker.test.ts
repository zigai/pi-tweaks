import assert from "node:assert/strict";
import { test } from "vitest";

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createThinkingPicker } from "../src/thinking-picker.ts";

const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];

function mouseClick(y: number) {
    return {
        type: "click" as const,
        button: "left" as const,
        x: 2,
        y,
        screenX: 20,
        screenY: 10 + y,
        width: 14,
        height: levels.length + 1,
        shift: false,
        alt: false,
        ctrl: false,
    };
}

function createFixture() {
    const selected: ThinkingLevel[] = [];
    let cancelled = false;
    let renders = 0;
    const picker = createThinkingPicker({
        currentLevel: "medium",
        levels,
        theme: {
            bg: (_role, text) => text,
            fg: (_role, text) => text,
        },
        requestRender: () => {
            renders += 1;
        },
        onSelect: (level) => {
            selected.push(level);
        },
        onCancel: () => {
            cancelled = true;
        },
    });

    return {
        picker,
        selected,
        get cancelled() {
            return cancelled;
        },
        get renders() {
            return renders;
        },
    };
}

test("thinking picker preselects the current level and accepts a mouse choice", () => {
    const fixture = createFixture();

    assert.deepEqual(fixture.picker.render(14), [
        " Thinking     ",
        "  off         ",
        "  low         ",
        "→ medium      ",
        "  high        ",
    ]);
    assert.deepEqual(fixture.picker.handleMouse(mouseClick(4)), {
        handled: true,
        render: false,
    });
    assert.deepEqual(fixture.selected, ["high"]);
});

test("thinking picker supports keyboard navigation and cancellation", () => {
    const fixture = createFixture();

    fixture.picker.handleInput("\x1b[A");
    fixture.picker.handleInput("\r");
    assert.equal(fixture.renders, 1);
    assert.deepEqual(fixture.selected, ["low"]);
    fixture.picker.handleInput("\x1b");
    assert.equal(fixture.cancelled, true);
});
