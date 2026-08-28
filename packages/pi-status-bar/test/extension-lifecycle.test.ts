import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Loader, type TUI } from "@earendil-works/pi-tui";

import statusBarExtension from "../src/index.ts";
import { resetStatusBarStateForTests } from "../src/status-bar-api.ts";
import {
    resetWorkedForWidgetCache,
    WIDGET_KEY,
    WORKED_FOR_STATE_ENTRY,
    type WorkedForState,
} from "../src/worked-for-widget.ts";

type LifecycleEvent = {
    readonly message?: {
        readonly role?: string;
        readonly stopReason?: string;
        readonly usage?: { readonly output: number };
    };
    readonly assistantMessageEvent?: { readonly type: string };
};
type WidgetFactory = (
    tui: TUI,
    theme: { fg(role: string, text: string): string },
) => { render(width: number): string[] };
type LifecycleContext = {
    readonly hasUI: true;
    readonly sessionManager: { getBranch(): readonly SessionEntry[] };
    readonly ui: { setWidget(key: string, nextWidget: WidgetFactory | undefined): void };
};
type EventHandler = (event: LifecycleEvent, ctx: LifecycleContext) => void | Promise<void>;
type LifecycleHarness = {
    readonly appendEntries: WorkedForState[];
    readonly context: LifecycleContext;
    readonly currentWidget: () => WidgetFactory | undefined;
    readonly invoke: (event: string, payload?: LifecycleEvent) => Promise<void>;
};
type LoaderPrototypeOwner = {
    updateDisplay: (this: Loader) => void;
};
type LoaderPrototypeBoundary = Loader | LoaderPrototypeOwner;

function isLoaderPrototypeOwner(value: unknown): value is LoaderPrototypeOwner {
    return (
        typeof value === "object" &&
        value !== null &&
        "updateDisplay" in value &&
        typeof value.updateDisplay === "function"
    );
}
function parseLoaderPrototypeOwner(
    value: LoaderPrototypeBoundary,
): LoaderPrototypeOwner | undefined {
    if (!isLoaderPrototypeOwner(value)) return undefined;
    return value;
}

function createHarness(): LifecycleHarness {
    const handlers = new Map<string, EventHandler>();
    const appendEntries: WorkedForState[] = [];
    let widget: WidgetFactory | undefined;
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
    // SAFETY: Registration uses only the `on` and `appendEntry` methods supplied
    // by this fixture; handlers receive the lifecycle shapes modeled above.
    statusBarExtension(api as ExtensionAPI);

    const context: LifecycleContext = {
        hasUI: true,
        sessionManager: {
            getBranch: () => branch,
        },
        ui: {
            setWidget(key: string, nextWidget: WidgetFactory | undefined): void {
                assert.equal(key, WIDGET_KEY);
                widget = nextWidget;
            },
        },
    };

    return {
        appendEntries,
        context,
        currentWidget: () => widget,
        async invoke(event: string, payload: LifecycleEvent = {}): Promise<void> {
            const handler = handlers.get(event);
            if (handler === undefined) throw new Error(`Missing ${event} handler`);
            await handler(payload, context);
        },
    };
}

function renderedWidgetText(widget: WidgetFactory | undefined): string {
    if (widget === undefined) throw new Error("Expected widget factory");
    // SAFETY: The widget factory under test does not read its TUI argument.
    const component = widget({} as TUI, { fg: (_role, text) => text });
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
    const prototype = parseLoaderPrototypeOwner(Loader.prototype);
    if (prototype === undefined) {
        throw new Error("Expected patched Loader.updateDisplay");
    }
    const statusUpdateDisplay = prototype.updateDisplay;
    const laterUpdateDisplay = function laterUpdateDisplay(this: Loader): void {
        statusUpdateDisplay.call(this);
    };
    prototype.updateDisplay = laterUpdateDisplay;

    await harness.invoke("session_shutdown");
    assert.equal(harness.currentWidget(), undefined);
    assert.equal(prototype.updateDisplay, laterUpdateDisplay);

    let renders = 0;
    const ui = {
        requestRender(): void {
            renders += 1;
        },
    };
    // SAFETY: Loader only calls requestRender on its TUI dependency here.
    const concurrentLoader = new Loader(
        ui as TUI,
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
    assert.equal(prototype.updateDisplay, laterUpdateDisplay);

    // SAFETY: Loader only calls requestRender on its TUI dependency here.
    const unpatchedLoader = new Loader(
        ui as TUI,
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
