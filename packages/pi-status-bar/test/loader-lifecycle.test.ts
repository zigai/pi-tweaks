import assert from "node:assert/strict";
import { afterEach, beforeAll, beforeEach, describe, test, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    Loader,
    TuiMainScreen,
    visibleWidth,
    type TUI,
    type Terminal,
} from "@earendil-works/pi-tui";

import statusBarExtension from "../src/index.ts";
import {
    configureStatusBar,
    registerStatusBarSegment,
    resetStatusBarStateForTests,
} from "../src/status-bar-api.ts";

type LoaderUpdateDisplay = (this: Loader) => void;

type TuiInternals = {
    doRender(): void;
    previousLines: string[];
};

class FakeTerminal implements Terminal {
    columns = 48;
    rows = 10;
    writes: string[] = [];

    get kittyProtocolActive(): boolean {
        return false;
    }

    start(): void {}
    stop(): void {}
    async drainInput(): Promise<void> {}
    write(data: string): void {
        this.writes.push(data);
    }
    moveBy(): void {}
    hideCursor(): void {}
    showCursor(): void {}
    clearLine(): void {}
    clearFromCursor(): void {}
    clearScreen(): void {}
    setTitle(): void {}
    setProgress(): void {}
}

function getTuiInternals(tui: TuiMainScreen): TuiInternals {
    const value: unknown = tui;
    const doRender: unknown = Reflect.get(tui, "doRender") as unknown;
    const previousLines: unknown = Reflect.get(tui, "previousLines") as unknown;
    if (
        typeof doRender !== "function" ||
        !Array.isArray(previousLines) ||
        !previousLines.every((line) => typeof line === "string")
    ) {
        throw new Error("Expected TUI render internals");
    }
    return value as TuiInternals;
}

let predecessorUpdateCount = 0;

function getLoaderUpdateDisplay(): LoaderUpdateDisplay {
    const value: unknown = Reflect.get(Loader.prototype, "updateDisplay");
    if (typeof value !== "function") {
        throw new Error("Expected Loader.updateDisplay to be callable");
    }
    // SAFETY: The runtime guard proves the private Loader seam is callable, and
    // tests invoke it only with real Loader instances.
    return value as LoaderUpdateDisplay;
}

function createExtensionApi(): ExtensionAPI {
    const api = {
        appendEntry(): void {},
        on(): void {},
    };
    // SAFETY: Extension registration uses only `on` and `appendEntry` in these
    // loader-focused tests.
    return api as unknown as ExtensionAPI;
}

function createLoader(frames: string[] = ["⠙"]): {
    readonly loader: Loader;
    readonly renderCount: () => number;
} {
    let renders = 0;
    const ui = {
        requestRender(): void {
            renders += 1;
        },
    };
    // SAFETY: Loader only calls requestRender on its TUI dependency here.
    const loader = new Loader(
        ui as TUI,
        (text) => text,
        (text) => text,
        "Working...",
        {
            frames,
        },
    );
    return { loader, renderCount: () => renders };
}

function visibleLoaderLines(loader: Loader): string[] {
    return loader.render(80).map((line) => line.trimEnd());
}

beforeAll(() => {
    resetStatusBarStateForTests();
    const originalUpdateDisplay = getLoaderUpdateDisplay();
    Reflect.set(Loader.prototype, "updateDisplay", function precedingUpdate(this: Loader): void {
        predecessorUpdateCount += 1;
        originalUpdateDisplay.call(this);
    });
    statusBarExtension(createExtensionApi());
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    configureStatusBar({}).dispose();
    predecessorUpdateCount = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

describe("status loader lifecycle", () => {
    test("keeps a static indicator timer advancing", () => {
        const { loader, renderCount } = createLoader();

        assert.deepEqual(visibleLoaderLines(loader), ["", " ⠙ Working... (0s)"]);
        const initialRenderCount = renderCount();

        vi.advanceTimersByTime(1_100);

        assert.deepEqual(visibleLoaderLines(loader), ["", " ⠙ Working... (1s)"]);
        assert.ok(renderCount() > initialRenderCount);

        loader.stop();
        const stoppedRenderCount = renderCount();
        vi.advanceTimersByTime(2_000);
        assert.equal(renderCount(), stoppedRenderCount);
    });

    test("preserves elapsed time when another extension changes the indicator", () => {
        const { loader } = createLoader();
        vi.advanceTimersByTime(2_100);
        assert.deepEqual(visibleLoaderLines(loader), ["", " ⠙ Working... (2s)"]);

        loader.setIndicator({ frames: ["■"] });

        assert.deepEqual(visibleLoaderLines(loader), ["", " ■ Working... (2s)"]);
        vi.advanceTimersByTime(1_000);
        assert.deepEqual(visibleLoaderLines(loader), ["", " ■ Working... (3s)"]);
        loader.stop();
    });

    test("composes with update wrappers installed before and after it", () => {
        const { loader } = createLoader();
        assert.ok(predecessorUpdateCount > 0);

        const statusBarUpdateDisplay = getLoaderUpdateDisplay();
        let laterUpdateCount = 0;
        Reflect.set(Loader.prototype, "updateDisplay", function laterUpdate(this: Loader): void {
            laterUpdateCount += 1;
            statusBarUpdateDisplay.call(this);
        });

        try {
            configureStatusBar({ active: { text: "Coordinating" } });
            assert.equal(laterUpdateCount, 1);
            assert.deepEqual(visibleLoaderLines(loader), ["", " ⠙ Coordinating (0s)"]);
        } finally {
            Reflect.set(Loader.prototype, "updateDisplay", statusBarUpdateDisplay);
            loader.stop();
        }
    });

    test("shares the active line with extension segments across resizes", () => {
        const segment = registerStatusBarSegment({
            id: "other-extension.progress",
            states: ["active"],
            text: "reviewing",
        });
        const { loader } = createLoader();

        const wideLine = loader.render(48)[1] ?? "";
        assert.match(wideLine, /Working\.\.\. \(0s\)/);
        assert.match(wideLine, /reviewing/);
        assert.ok(visibleWidth(wideLine) <= 48);

        const narrowLine = loader.render(16)[1] ?? "";
        assert.doesNotMatch(narrowLine, /reviewing/);
        assert.ok(visibleWidth(narrowLine) <= 16);

        segment.dispose();
        loader.stop();
    });

    test("renders active composition and resize truncation onto a real terminal screen", () => {
        configureStatusBar({ active: { text: "Coordinating" } });
        const segment = registerStatusBarSegment({
            id: "other-extension.screen-progress",
            states: ["active"],
            text: "reviewing",
        });
        const terminal = new FakeTerminal();
        const tui = new TuiMainScreen(terminal);
        const loader = new Loader(
            tui,
            (text) => text,
            (text) => text,
            "Working...",
            { frames: ["●"] },
        );
        const internals = getTuiInternals(tui);
        tui.addChild(loader);

        try {
            terminal.writes = [];
            internals.doRender();
            const wideTerminalWrites = terminal.writes.join("");
            assert.match(wideTerminalWrites, /● Coordinating \(0s\).*reviewing/);
            assert.ok(internals.previousLines.every((line) => visibleWidth(line) <= 48));

            terminal.columns = 18;
            terminal.writes = [];
            internals.doRender();
            const narrowTerminalWrites = terminal.writes.join("");
            assert.match(narrowTerminalWrites, /● Coordinat/);
            assert.doesNotMatch(narrowTerminalWrites, /reviewing/);
            assert.ok(internals.previousLines.every((line) => visibleWidth(line) <= 18));
        } finally {
            segment.dispose();
            loader.stop();
            tui.stop();
        }
    });
});
