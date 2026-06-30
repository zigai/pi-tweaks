import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WIDGET_KEY } from "../src/constants.ts";
import { formatDuration, setWorkedForWidget } from "../src/worked-for-widget.ts";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
    return value.replace(ANSI_PATTERN, "");
}

type WidgetFactory = (
    tui: unknown,
    theme: { fg(role: string, text: string): string },
) => { render(width: number): string[]; invalidate(): void };

function widgetContext(): { ctx: ExtensionContext; currentWidget: () => unknown } {
    let widget: unknown;
    const ctx = {
        hasUI: true,
        ui: {
            setWidget(key: string, nextWidget: unknown) {
                assert.equal(key, WIDGET_KEY);
                widget = nextWidget;
            },
        },
    } as unknown as ExtensionContext;

    return {
        ctx,
        currentWidget() {
            return widget;
        },
    };
}

test("formatDuration rounds to seconds and uses readable minute/hour boundaries", () => {
    assert.equal(formatDuration(-10), "0s");
    assert.equal(formatDuration(1_400), "1s");
    assert.equal(formatDuration(65_000), "1m 05s");
    assert.equal(formatDuration(3_660_000), "1h 01m");
});

test("setWorkedForWidget renders duration and token rate within the provided width", () => {
    const { ctx, currentWidget } = widgetContext();
    setWorkedForWidget(ctx, "1m 05s", 42);

    const widget = currentWidget();
    assert.equal(typeof widget, "function");
    const factory = widget as WidgetFactory;
    const component = factory({}, { fg: (_role, text) => `[dim]${text}` });

    assert.deepEqual(component.render(80), ["[dim] Worked for 1m 05s. [42 tok/s]"]);
    const narrowLine = component.render(12)[0] ?? "";
    assert.equal(stripAnsi(narrowLine), "[dim] Worked for ");
    assert.deepEqual(component.render(0), [""]);
});
