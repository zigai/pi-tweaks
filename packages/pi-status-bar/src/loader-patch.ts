import { installLinkedMethodPatch } from "@zigai/pi-extension-internals";
import { Loader, visibleWidth } from "@earendil-works/pi-tui";

import { getRightMessageMinGap, renderRightMessage } from "./right-message.ts";
import { getStatusBarSnapshot, subscribeStatusBarUpdates } from "./status-bar-api.ts";

const LOADER_TIME_PATCH_CONTROLLER_KEY = Symbol.for(
    "zigai.pi-status-bar.loader-time-patch-controller",
);
const LOADER_TIME_PATCH_VERSION = 5;
const MIN_VISIBLE_RIGHT_MESSAGE_WIDTH = 4;
const STATIC_LOADER_REFRESH_INTERVAL_MS = 1_000;

type LoaderMethod = (this: Loader) => void;
type LoaderRenderMethod = (this: Loader, width: number) => string[];
type LoaderPrototype = {
    start: LoaderMethod;
    stop: LoaderMethod;
    updateDisplay: LoaderMethod;
    render: LoaderRenderMethod;
};
type LoaderPatchController = {
    readonly version: number;
    acquire(): () => void;
};
type PatchState = typeof globalThis & {
    [LOADER_TIME_PATCH_CONTROLLER_KEY]?: LoaderPatchController;
};
type LoaderDisplay = {
    readonly leftText: string;
    readonly messageColorFn: (text: string) => string;
    readonly startedAt: number;
};
type LoaderTimer = {
    startedAt: number;
    accumulatedPausedMs: number;
    resetVersion: number;
    pausedAt?: number;
};
type LoaderInternals = {
    frames: string[];
    currentFrame: number;
    renderIndicatorVerbatim: boolean;
    spinnerColorFn(text: string): string;
    message: string;
    messageColorFn(text: string): string;
    setText(text: string): void;
    ui: { requestRender(): void } | null;
};

const loaderTimers = new WeakMap<object, LoaderTimer>();
const loaderDisplays = new WeakMap<object, LoaderDisplay>();
const activeLoaders = new Set<Loader>();
let activeLoaderRefreshInterval: ReturnType<typeof setInterval> | undefined;

function getLoaderTimer(loader: Loader, now: number): LoaderTimer {
    let timer = loaderTimers.get(loader);
    if (timer === undefined) {
        timer = {
            startedAt: now,
            accumulatedPausedMs: 0,
            resetVersion: getStatusBarSnapshot().active.timerResetVersion,
        };
        loaderTimers.set(loader, timer);
    }
    return timer;
}

function getElapsedMs(loader: Loader, now: number): { elapsedMs: number; startedAt: number } {
    const snapshot = getStatusBarSnapshot();
    const timer = getLoaderTimer(loader, now);
    if (timer.resetVersion !== snapshot.active.timerResetVersion) {
        timer.startedAt = now;
        timer.accumulatedPausedMs = 0;
        delete timer.pausedAt;
        timer.resetVersion = snapshot.active.timerResetVersion;
    }

    if (snapshot.active.timerPaused) {
        timer.pausedAt ??= now;
    } else if (timer.pausedAt !== undefined) {
        timer.accumulatedPausedMs += Math.max(0, now - timer.pausedAt);
        delete timer.pausedAt;
    }

    const effectiveNow = timer.pausedAt ?? now;
    return {
        elapsedMs: Math.max(0, effectiveNow - timer.startedAt - timer.accumulatedPausedMs),
        startedAt: timer.startedAt + timer.accumulatedPausedMs,
    };
}

function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainingSeconds}s`;
}

function applyStatusBarDisplay(loader: Loader): void {
    const loaderInternals: unknown = loader;
    // SAFETY: Loader instances are created by Pi and this adapter consumes only the
    // documented-at-runtime fields required to replace its display text.
    const internals = loaderInternals as LoaderInternals;
    const snapshot = getStatusBarSnapshot();
    const frames = snapshot.active.spinnerFrames ?? internals.frames;
    const frame = frames[internals.currentFrame % Math.max(1, frames.length)] ?? "";
    let renderedFrame = internals.spinnerColorFn(frame);
    if (internals.renderIndicatorVerbatim) renderedFrame = frame;
    let indicator = "";
    if (frame.length > 0) indicator = `${renderedFrame} `;
    const now = Date.now();
    const elapsed = getElapsedMs(loader, now);
    const baseMessage = snapshot.active.text ?? internals.message;
    let message = baseMessage;
    if (snapshot.active.timerVisible) {
        message = `${baseMessage} (${formatElapsed(Math.floor(elapsed.elapsedMs / 1000))})`;
    }
    const leftText = `${indicator}${internals.messageColorFn(message)}`;

    loaderDisplays.set(loader, {
        leftText,
        messageColorFn: (text: string) => internals.messageColorFn(text),
        startedAt: elapsed.startedAt,
    });
    internals.setText(leftText);
}

function renderDisplay(
    loader: Loader,
    display: LoaderDisplay,
    width: number,
    predecessor: LoaderRenderMethod,
): string[] {
    if (width <= 0) return predecessor.call(loader, width);

    const paddingValue: unknown = Reflect.get(loader, "paddingX");
    let paddingX = 1;
    if (typeof paddingValue === "number" && Number.isFinite(paddingValue) && paddingValue >= 0) {
        paddingX = Math.floor(paddingValue);
    }
    paddingX = Math.min(paddingX, Math.max(0, Math.floor((width - 1) / 2)));

    const contentWidth = Math.max(1, width - paddingX * 2);
    const leftWidth = visibleWidth(display.leftText);
    const minGap = getRightMessageMinGap();
    const availableRightWidth = contentWidth - leftWidth - minGap;
    if (availableRightWidth < MIN_VISIBLE_RIGHT_MESSAGE_WIDTH) {
        return predecessor.call(loader, width);
    }

    const right = renderRightMessage(
        Math.max(0, Date.now() - display.startedAt),
        availableRightWidth,
        display.messageColorFn,
    );
    if (right === undefined) return predecessor.call(loader, width);

    const gapWidth = Math.max(minGap, contentWidth - leftWidth - right.width);
    const content = `${display.leftText}${" ".repeat(gapWidth)}${right.text}`;
    const lineWithPadding = `${" ".repeat(paddingX)}${content}`;
    return [
        "",
        `${lineWithPadding}${" ".repeat(Math.max(0, width - visibleWidth(lineWithPadding)))}`,
    ];
}

function requestLoaderUpdate(loader: Loader): void {
    const updateDisplay: unknown = Reflect.get(loader, "updateDisplay");
    if (typeof updateDisplay === "function") Reflect.apply(updateDisplay, loader, []);
}

function requestActiveLoaderRenders(): void {
    for (const loader of activeLoaders) requestLoaderUpdate(loader);
}

function clearActiveLoaderRefreshInterval(): void {
    if (activeLoaderRefreshInterval === undefined) return;
    clearInterval(activeLoaderRefreshInterval);
    activeLoaderRefreshInterval = undefined;
}

function updateActiveLoaderRefreshInterval(): void {
    if (activeLoaders.size === 0) {
        clearActiveLoaderRefreshInterval();
        return;
    }
    if (activeLoaderRefreshInterval !== undefined) return;
    activeLoaderRefreshInterval = setInterval(
        requestActiveLoaderRenders,
        STATIC_LOADER_REFRESH_INTERVAL_MS,
    );
    activeLoaderRefreshInterval.unref?.();
}

export function installLoaderPatch(): () => void {
    const state = globalThis as PatchState;
    const existingController = state[LOADER_TIME_PATCH_CONTROLLER_KEY];
    if (existingController?.version === LOADER_TIME_PATCH_VERSION) {
        return existingController.acquire();
    }

    const candidate: unknown = Loader.prototype;
    const start: unknown = Reflect.get(candidate as object, "start");
    const stop: unknown = Reflect.get(candidate as object, "stop");
    const updateDisplay: unknown = Reflect.get(candidate as object, "updateDisplay");
    const render: unknown = Reflect.get(candidate as object, "render");
    if (
        typeof start !== "function" ||
        typeof stop !== "function" ||
        typeof updateDisplay !== "function" ||
        typeof render !== "function"
    ) {
        return () => {};
    }
    // SAFETY: Each method required by LoaderPrototype was validated as callable above.
    const prototype = candidate as LoaderPrototype;

    let active = false;
    let leaseCount = 0;
    let unsubscribeStatusBarUpdates: (() => void) | undefined;

    const startPatch = installLinkedMethodPatch(
        prototype,
        "start",
        (predecessor) =>
            function patchedStart(this: Loader): void {
                if (!active) {
                    predecessor.call(this);
                    return;
                }
                const existingTimer = loaderTimers.get(this);
                const startedAt = Date.now();
                predecessor.call(this);
                activeLoaders.add(this);
                loaderTimers.set(
                    this,
                    existingTimer ?? {
                        startedAt,
                        accumulatedPausedMs: 0,
                        resetVersion: getStatusBarSnapshot().active.timerResetVersion,
                    },
                );
                updateActiveLoaderRefreshInterval();
                requestLoaderUpdate(this);
            },
    );
    const stopPatch = installLinkedMethodPatch(
        prototype,
        "stop",
        (predecessor) =>
            function patchedStop(this: Loader): void {
                try {
                    predecessor.call(this);
                } finally {
                    activeLoaders.delete(this);
                    loaderTimers.delete(this);
                    loaderDisplays.delete(this);
                    updateActiveLoaderRefreshInterval();
                }
            },
    );
    const updatePatch = installLinkedMethodPatch(
        prototype,
        "updateDisplay",
        (predecessor) =>
            function patchedUpdateDisplay(this: Loader): void {
                predecessor.call(this);
                if (active && activeLoaders.has(this)) applyStatusBarDisplay(this);
            },
    );
    const renderPatch = installLinkedMethodPatch(
        prototype,
        "render",
        (predecessor) =>
            function patchedRender(this: Loader, width: number): string[] {
                if (!active) return predecessor.call(this, width);
                const display = loaderDisplays.get(this);
                if (display === undefined) return predecessor.call(this, width);
                return renderDisplay(this, display, width, predecessor);
            },
    );

    const controller: LoaderPatchController = {
        version: LOADER_TIME_PATCH_VERSION,
        acquire(): () => void {
            leaseCount += 1;
            if (!active) {
                active = true;
                unsubscribeStatusBarUpdates ??= subscribeStatusBarUpdates(
                    requestActiveLoaderRenders,
                );
            }

            let released = false;
            return () => {
                if (released) return;
                released = true;
                leaseCount = Math.max(0, leaseCount - 1);
                if (leaseCount > 0 || !active) return;

                active = false;
                unsubscribeStatusBarUpdates?.();
                unsubscribeStatusBarUpdates = undefined;
                clearActiveLoaderRefreshInterval();

                const loaders = [...activeLoaders];
                activeLoaders.clear();
                for (const loader of loaders) {
                    loaderTimers.delete(loader);
                    loaderDisplays.delete(loader);
                }

                renderPatch.dispose();
                updatePatch.dispose();
                stopPatch.dispose();
                startPatch.dispose();
                for (const loader of loaders) requestLoaderUpdate(loader);
                if (state[LOADER_TIME_PATCH_CONTROLLER_KEY] === controller) {
                    delete state[LOADER_TIME_PATCH_CONTROLLER_KEY];
                }
            };
        },
    };

    state[LOADER_TIME_PATCH_CONTROLLER_KEY] = controller;
    return controller.acquire();
}
