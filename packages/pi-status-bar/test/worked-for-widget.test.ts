import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";

import { WIDGET_KEY } from "../src/constants.ts";
import { configureStatusBar, resetStatusBarStateForTests } from "../src/status-bar-api.ts";
import {
    clearWorkedForWidget,
    formatDuration,
    resetWorkedForWidgetCache,
    setWorkedForWidget,
    type WorkedForWidgetContext,
} from "../src/worked-for-widget.ts";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

beforeEach(() => {
    resetStatusBarStateForTests();
    resetWorkedForWidgetCache();
});

function stripAnsi(value: string): string {
    return value.replace(ANSI_PATTERN, "");
}

type WidgetFactory = (
    tui: unknown,
    theme: { fg(role: string, text: string): string },
) => { render(width: number): string[]; invalidate(): void };

function getWidgetFactory(value: unknown): WidgetFactory {
    if (typeof value !== "function") {
        throw new Error("Expected widget factory");
    }
    // SAFETY: The status-widget integration seam stores only callable factories;
    // this test invokes the factory only with the narrow TUI/theme/data shape it verifies.
    return value as WidgetFactory;
}

function widgetContext(): {
    ctx: WorkedForWidgetContext;
    currentWidget: () => unknown;
    updateCount: () => number;
} {
    let widget: unknown;
    let updates = 0;
    const ctx = {
        hasUI: true,
        ui: {
            setWidget(
                key: Parameters<WorkedForWidgetContext["ui"]["setWidget"]>[0],
                nextWidget: Parameters<WorkedForWidgetContext["ui"]["setWidget"]>[1],
            ) {
                assert.equal(key, WIDGET_KEY);
                widget = nextWidget;
                updates += 1;
            },
        },
    } satisfies WorkedForWidgetContext;

    return {
        ctx,
        currentWidget() {
            return widget;
        },
        updateCount() {
            return updates;
        },
    };
}

test("formatDuration rounds to seconds and uses readable minute/hour boundaries", () => {
    assert.equal(formatDuration(-10), "0s");
    assert.equal(formatDuration(1_400), "1s");
    assert.equal(formatDuration(65_000), "1m 05s");
    assert.equal(formatDuration(3_660_000), "1h 01m");
});

test("setWorkedForWidget skips unchanged widget updates", () => {
    const { ctx, updateCount } = widgetContext();

    setWorkedForWidget(ctx, undefined);
    assert.equal(updateCount(), 0);

    setWorkedForWidget(ctx, "10s", 2);
    assert.equal(updateCount(), 1);

    setWorkedForWidget(ctx, "10s", 2);
    assert.equal(updateCount(), 1);

    setWorkedForWidget(ctx, "11s", 2);
    assert.equal(updateCount(), 2);

    setWorkedForWidget(ctx, undefined);
    assert.equal(updateCount(), 3);

    setWorkedForWidget(ctx, undefined);
    assert.equal(updateCount(), 3);
});

test("setWorkedForWidget renders duration and token rate within the provided width", () => {
    const { ctx, currentWidget } = widgetContext();
    setWorkedForWidget(ctx, "1m 05s", 42);

    const widget = currentWidget();
    assert.equal(typeof widget, "function");
    const factory = getWidgetFactory(widget);
    const component = factory({}, { fg: (_role, text) => `[dim]${text}` });

    assert.deepEqual(component.render(80), ["[dim] Worked for 1m 05s. [42 tok/s]"]);
    const narrowLine = component.render(12)[0] ?? "";
    assert.equal(stripAnsi(narrowLine), "[dim] Worked for ");
    assert.deepEqual(component.render(0), [""]);
});

test("setWorkedForWidget renders idle status bar overrides with the last-run summary", () => {
    configureStatusBar({
        idle: {
            text: "Ready",
            showLastRunSummary: true,
        },
    });
    const { ctx, currentWidget } = widgetContext();

    setWorkedForWidget(ctx, "9s", 3);

    const widget = currentWidget();
    assert.equal(typeof widget, "function");
    const factory = getWidgetFactory(widget);
    const component = factory({}, { fg: (_role, text) => `[dim]${text}` });

    assert.deepEqual(component.render(80), ["[dim] Ready · Worked for 9s. [3 tok/s]"]);
});

test("clearWorkedForWidget removes configured idle status during active runs", () => {
    configureStatusBar({
        idle: {
            text: "Ready",
            showLastRunSummary: true,
        },
    });
    const { ctx, currentWidget, updateCount } = widgetContext();

    setWorkedForWidget(ctx, undefined);
    assert.equal(typeof currentWidget(), "function");
    assert.equal(updateCount(), 1);

    clearWorkedForWidget(ctx);

    assert.equal(currentWidget(), undefined);
    assert.equal(updateCount(), 2);
});
