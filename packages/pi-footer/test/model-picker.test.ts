import assert from "node:assert/strict";
import { test } from "vitest";

import type { Api, Model } from "@earendil-works/pi-ai";
import { createModelPicker, MODEL_PICKER_WIDTH } from "../src/model-picker.ts";

function model(id: string, name: string): Model<Api> {
    return {
        id,
        name,
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://example.test",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 10_000,
    };
}

const activeModel = model("gpt-5.6-luna", "GPT-5.6 Luna");
const models = [model("gpt-5.4", "GPT-5.4"), activeModel, model("gpt-5.6-mini", "GPT-5.6 Mini")];

const theme = {
    bg(_role: "toolPendingBg" | "selectedBg", text: string): string {
        return text;
    },
    fg(_role: "accent" | "borderAccent" | "dim" | "text", text: string): string {
        return text;
    },
};

function picker(
    overrides: {
        onSelect?: (selected: Model<Api>) => void;
        onCancel?: () => void;
        requestRender?: () => void;
        pickerTheme?: typeof theme;
    } = {},
) {
    return createModelPicker({
        activeModel,
        models,
        theme: overrides.pickerTheme ?? theme,
        requestRender: overrides.requestRender ?? (() => undefined),
        onSelect: overrides.onSelect ?? (() => undefined),
        onCancel: overrides.onCancel ?? (() => undefined),
    });
}

test("model picker renders only its search field and plain model names", () => {
    const component = picker();
    const rendered = component.render(MODEL_PICKER_WIDTH).join("\n");
    assert.match(rendered, /Search models…/);
    assert.doesNotMatch(rendered, /Models ·/);
    assert.match(rendered, /GPT-5\.6 Luna ✓/);
    assert.doesNotMatch(rendered, /reasoning|fast|tool-use|navigate|select|esc/i);
});

test("model picker uses Pi's configurable selected-option indicator", () => {
    const component = picker({
        pickerTheme: {
            bg(_role, text): string {
                return text;
            },
            fg(role, text): string {
                if (role === "accent" && text === "→ ") return "▌ ";
                return text;
            },
        },
    });

    const rendered = component.render(MODEL_PICKER_WIDTH).join("\n");
    assert.match(rendered, /▌ GPT-5\.6 Luna ✓/);
    assert.doesNotMatch(rendered, /›|→/);
});

test("model picker fuzzy-filters names and model IDs while typing", () => {
    const component = picker();

    for (const character of "mini") component.handleInput(character);

    const rendered = component.render(MODEL_PICKER_WIDTH).join("\n");
    assert.match(rendered, /GPT-5\.6 Mini/);
    assert.doesNotMatch(rendered, /GPT-5\.4/);
    assert.doesNotMatch(rendered, /GPT-5\.6 Luna/);
});

test("model picker selects filtered models with the keyboard", () => {
    const selections: Model<Api>[] = [];
    const component = picker({
        onSelect(selected) {
            selections.push(selected);
        },
    });

    component.handleInput("\x1b[B");
    component.handleInput("\r");
    assert.equal(selections[0]?.id, "gpt-5.6-mini");
});

test("model picker selects visible model rows with the mouse", () => {
    const selections: Model<Api>[] = [];
    const component = picker({
        onSelect(selected) {
            selections.push(selected);
        },
    });

    const result = component.handleMouse({
        type: "click",
        button: "left",
        x: 6,
        y: 1,
        screenX: 30,
        screenY: 12,
        width: MODEL_PICKER_WIDTH,
        height: 5,
        shift: false,
        alt: false,
        ctrl: false,
    });

    assert.deepEqual(result, { handled: true, render: false });
    assert.equal(selections[0]?.id, "gpt-5.4");
});

test("model picker cancels with escape", () => {
    let cancelled = false;
    const component = picker({
        onCancel() {
            cancelled = true;
        },
    });

    component.handleInput("\x1b");
    assert.equal(cancelled, true);
});
