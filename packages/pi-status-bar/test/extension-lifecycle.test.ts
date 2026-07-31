import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Loader, type TUI } from "@earendil-works/pi-tui";

import { WIDGET_KEY } from "../src/constants.ts";
import statusBarExtension from "../src/index.ts";
import { resetStatusBarStateForTests } from "../src/status-bar-api.ts";
import {
    resetWorkedForWidgetCache,
    WORKED_FOR_STATE_ENTRY,
    type WorkedForState,
} from "../src/worked-for-widget.ts";

type EventHandler = (event: unknown, ctx: unknown) => unknown;
type WidgetFactory = (
    tui: unknown,
    theme: { fg(role: string, text: string): string },
) => { render(width: number): string[] };

function getWidgetFactory(value: unknown): WidgetFactory {
    if (typeof value !== "function") throw new Error("Expected widget factory");
    // SAFETY: The extension stores a widget factory at this tested boundary.
    return value as WidgetFactory;
}

function createHarness(): {
    readonly appendEntries: WorkedForState[];
    readonly context: unknown;
    readonly currentWidget: () => unknown;
    readonly invoke: (event: string, payload?: unknown) => Promise<void>;
} {
    const handlers = new Map<string, EventHandler>();
    const appendEntries: WorkedForState[] = [];
    let widget: unknown;
    let branch: SessionEntry[] = [];

    const api = {
        appendEntry(customType: string, data: WorkedForState): void {
            assert.equal(customType, WORKED_FOR_STATE_ENTRY);
            appendEntries.push(data);
            branch = [
                ...branch,
                {
                    type: "custom",
                    id: `entry-${branch.length}`,
                    parentId: null,
                    timestamp: "2026-07-30T00:00:00.000Z",
                    customType,
                    data,
                },
            ];
        },
        on(event: string, handler: EventHandler): void {
            handlers.set(event, handler);
        },
    };
    // SAFETY: This lifecycle harness implements the complete ExtensionAPI surface
    // consumed during registration and the exercised handlers.
    statusBarExtension(api as unknown as ExtensionAPI);

    const context = {
        hasUI: true,
        sessionManager: {
            getBranch: () => branch,
        },
        ui: {
            setWidget(key: string, nextWidget: unknown): void {
                assert.equal(key, WIDGET_KEY);
                widget = nextWidget;
            },
        },
    };

    return {
        appendEntries,
        context,
        currentWidget: () => widget,
        async invoke(event: string, payload: unknown = {}): Promise<void> {
            const handler = handlers.get(event);
            if (handler === undefined) throw new Error(`Missing ${event} handler`);
            await handler(payload, context);
        },
    };
}

function renderedWidgetText(widget: unknown): string {
    const component = getWidgetFactory(widget)({}, { fg: (_role, text) => text });
    return component.render(80)[0] ?? "";
}

test("status extension covers completion, abort, restore, and cleanup lifecycles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetStatusBarStateForTests();
    resetWorkedForWidgetCache();
    const harness = createHarness();
    const concurrentHarness = createHarness();

    await harness.invoke("agent_start");
    vi.setSystemTime(100);
    await harness.invoke("message_start", { message: { role: "assistant" } });
    vi.setSystemTime(200);
    await harness.invoke("message_update", {
        message: { role: "assistant" },
        assistantMessageEvent: { type: "text_delta" },
    });
    vi.setSystemTime(1_200);
    await harness.invoke("message_end", {
        message: { role: "assistant", usage: { output: 100 } },
    });
    vi.setSystemTime(2_200);
    await harness.invoke("agent_end");

    assert.deepEqual(harness.appendEntries, [{ durationMs: 2_200, tokensPerSecond: 100 }]);
    assert.equal(renderedWidgetText(harness.currentWidget()), " Worked for 2s. [100 tok/s]");

    await harness.invoke("agent_start");
    vi.setSystemTime(2_700);
    await harness.invoke("message_end", {
        message: { role: "assistant", stopReason: "aborted", usage: { output: 0 } },
    });
    await harness.invoke("agent_end");

    assert.deepEqual(harness.appendEntries[1], {
        durationMs: 500,
        tokensPerSecond: undefined,
    });
    assert.equal(renderedWidgetText(harness.currentWidget()), " Worked for 1s.");

    await harness.invoke("agent_start");
    vi.setSystemTime(3_200);
    await harness.invoke("message_end", {
        message: { role: "assistant", stopReason: "error", usage: { output: 0 } },
    });
    await harness.invoke("agent_end");

    assert.deepEqual(harness.appendEntries[2], {
        durationMs: 500,
        tokensPerSecond: undefined,
    });
    assert.equal(renderedWidgetText(harness.currentWidget()), " Worked for 1s.");

    await harness.invoke("session_tree");
    assert.equal(renderedWidgetText(harness.currentWidget()), " Worked for 1s.");

    const statusUpdateDisplay: unknown = Reflect.get(Loader.prototype, "updateDisplay");
    if (typeof statusUpdateDisplay !== "function") {
        throw new Error("Expected patched Loader.updateDisplay");
    }
    const laterUpdateDisplay = function laterUpdateDisplay(this: Loader): void {
        Reflect.apply(statusUpdateDisplay, this, []);
    };
    Reflect.set(Loader.prototype, "updateDisplay", laterUpdateDisplay);

    await harness.invoke("session_shutdown");
    assert.equal(harness.currentWidget(), undefined);
    assert.equal(Reflect.get(Loader.prototype, "updateDisplay"), laterUpdateDisplay);

    let renders = 0;
    const ui = {
        requestRender(): void {
            renders += 1;
        },
    };
    // SAFETY: Loader only calls requestRender on its TUI dependency here.
    const concurrentLoader = new Loader(
        ui as unknown as TUI,
        (text) => text,
        (text) => text,
        "Working...",
        {
            frames: ["⠙"],
        },
    );
    assert.deepEqual(
        concurrentLoader.render(80).map((line) => line.trimEnd()),
        ["", " ⠙ Working... (0s)"],
    );
    vi.advanceTimersByTime(1_100);
    assert.deepEqual(
        concurrentLoader.render(80).map((line) => line.trimEnd()),
        ["", " ⠙ Working... (1s)"],
    );
    concurrentLoader.stop();

    await concurrentHarness.invoke("session_shutdown");
    assert.equal(Reflect.get(Loader.prototype, "updateDisplay"), laterUpdateDisplay);

    const unpatchedLoader = new Loader(
        ui as unknown as TUI,
        (text) => text,
        (text) => text,
        "Working...",
        { frames: ["⠙"] },
    );
    assert.deepEqual(
        unpatchedLoader.render(80).map((line) => line.trimEnd()),
        ["", " ⠙ Working..."],
    );
    unpatchedLoader.stop();
    assert.ok(renders >= 3);
    vi.useRealTimers();
});
