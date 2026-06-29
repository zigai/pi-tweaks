import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Loader, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import {
    DEFAULT_RIGHT_MESSAGES_CONFIG,
    loadRunTimerConfig,
    type LoadedRunTimerConfig,
    type RightMessagesConfig,
} from "./settings.ts";
import { formatDuration, setWorkedForWidget } from "./worked-for-widget.ts";

const LOADER_TIME_PATCH_KEY = Symbol.for("zigai.pi-run-timer.loader-time-patched");
const LOADER_TIME_PATCH_VERSION_KEY = Symbol.for("zigai.pi-run-timer.loader-time-patch-version");
const RIGHT_MESSAGES_CONFIG_KEY = Symbol.for("zigai.pi-run-timer.right-messages-config");
const LOADER_TIME_PATCH_VERSION = 3;
const MIN_VISIBLE_RIGHT_MESSAGE_WIDTH = 4;

const loaderStartTimes = new WeakMap<object, number>();
const loaderDisplays = new WeakMap<object, LoaderDisplay>();
const reportedConfigErrors = new Set<string>();

type PatchState = typeof globalThis & {
    [LOADER_TIME_PATCH_KEY]?: boolean;
    [LOADER_TIME_PATCH_VERSION_KEY]?: number;
    [RIGHT_MESSAGES_CONFIG_KEY]?: RightMessagesConfig;
};

type LoaderDisplay = {
    readonly leftText: string;
    readonly messageColorFn: (text: string) => string;
    readonly startedAt: number;
};

function getPatchState(): PatchState {
    return globalThis as PatchState;
}

function getRightMessagesConfig(): RightMessagesConfig {
    return getPatchState()[RIGHT_MESSAGES_CONFIG_KEY] ?? DEFAULT_RIGHT_MESSAGES_CONFIG;
}

function setRightMessagesConfig(config: RightMessagesConfig): void {
    getPatchState()[RIGHT_MESSAGES_CONFIG_KEY] = config;
}

function getSafeRightMessageIntervalMs(config: RightMessagesConfig): number {
    if (Number.isFinite(config.intervalMs) && config.intervalMs > 0) {
        return config.intervalMs;
    }
    return DEFAULT_RIGHT_MESSAGES_CONFIG.intervalMs;
}

function getSafeScrollColumnIntervalMs(config: RightMessagesConfig): number {
    if (Number.isFinite(config.scrollColumnIntervalMs) && config.scrollColumnIntervalMs > 0) {
        return config.scrollColumnIntervalMs;
    }
    return DEFAULT_RIGHT_MESSAGES_CONFIG.scrollColumnIntervalMs;
}

function getSafeMinScrollCycles(config: RightMessagesConfig): number {
    if (Number.isFinite(config.minScrollCycles) && config.minScrollCycles > 0) {
        return config.minScrollCycles;
    }
    return DEFAULT_RIGHT_MESSAGES_CONFIG.minScrollCycles;
}

function getSafeMinGap(config: RightMessagesConfig): number {
    if (Number.isFinite(config.minGap) && config.minGap >= 0) {
        return config.minGap;
    }
    return DEFAULT_RIGHT_MESSAGES_CONFIG.minGap;
}

function getLoaderPaddingX(loader: Loader): number {
    const value = Reflect.get(loader, "paddingX");
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    return 1;
}

function padLineToWidth(line: string, width: number): string {
    const paddingNeeded = Math.max(0, width - visibleWidth(line));
    return `${line}${" ".repeat(paddingNeeded)}`;
}

function getLongMessageCycleDurationMs(
    messageWidth: number,
    viewportWidth: number,
    config: RightMessagesConfig,
): number {
    const maxOffset = Math.max(0, messageWidth - viewportWidth);
    return (maxOffset + 1) * getSafeScrollColumnIntervalMs(config);
}

function getMessageDurationMs(
    message: string,
    viewportWidth: number,
    config: RightMessagesConfig,
): number {
    const intervalMs = getSafeRightMessageIntervalMs(config);
    const messageWidth = visibleWidth(message);
    if (messageWidth <= viewportWidth) {
        return intervalMs;
    }

    const cycleDurationMs = getLongMessageCycleDurationMs(messageWidth, viewportWidth, config);
    const cyclesNeededForInterval = Math.ceil(intervalMs / cycleDurationMs);
    const cycleCount = Math.max(getSafeMinScrollCycles(config), cyclesNeededForInterval);
    return cycleDurationMs * cycleCount;
}

type SelectedRightMessage = {
    readonly elapsedMs: number;
    readonly message: string;
};

function selectRightMessage(
    config: RightMessagesConfig,
    elapsedMs: number,
    viewportWidth: number,
): SelectedRightMessage | undefined {
    if (config.enabled !== true || config.messages.length === 0 || viewportWidth <= 0) {
        return undefined;
    }

    const durations = config.messages.map((message) =>
        getMessageDurationMs(message, viewportWidth, config),
    );
    const totalDurationMs = durations.reduce((total, duration) => total + duration, 0);
    if (totalDurationMs <= 0) {
        return undefined;
    }

    let elapsedInRotation = elapsedMs % totalDurationMs;
    for (let index = 0; index < config.messages.length; index += 1) {
        const duration = durations[index] ?? 0;
        const message = config.messages[index];
        if (message === undefined) {
            continue;
        }
        if (elapsedInRotation < duration) {
            return { elapsedMs: elapsedInRotation, message };
        }
        elapsedInRotation -= duration;
    }

    const message = config.messages[0];
    if (message === undefined) {
        return undefined;
    }
    return { elapsedMs: 0, message };
}

function applyRightMessageStyle(message: string, config: RightMessagesConfig): string {
    let styled = message;
    if (config.dimmed) {
        styled = `\x1b[2m${styled}\x1b[22m`;
    }
    if (config.italic) {
        styled = `\x1b[3m${styled}\x1b[23m`;
    }
    return styled;
}

function renderRightMessageSegment(
    selected: SelectedRightMessage,
    viewportWidth: number,
    config: RightMessagesConfig,
): string {
    const messageWidth = visibleWidth(selected.message);
    if (messageWidth <= viewportWidth) {
        return selected.message;
    }

    const cycleDurationMs = getLongMessageCycleDurationMs(messageWidth, viewportWidth, config);
    const scrollColumnIntervalMs = getSafeScrollColumnIntervalMs(config);
    const elapsedInCycle = selected.elapsedMs % cycleDurationMs;
    const offset = Math.min(
        Math.max(0, messageWidth - viewportWidth),
        Math.floor(elapsedInCycle / scrollColumnIntervalMs),
    );
    return sliceByColumn(selected.message, offset, viewportWidth);
}

function renderDisplayWithRightMessage(
    loader: Loader,
    display: LoaderDisplay,
    width: number,
    originalRender: (this: Loader, width: number) => string[],
): string[] {
    if (width <= 0) {
        return originalRender.call(loader, width);
    }

    let paddingX = getLoaderPaddingX(loader);
    const maxPaddingX = Math.max(0, Math.floor((width - 1) / 2));
    if (paddingX > maxPaddingX) {
        paddingX = maxPaddingX;
    }

    const contentWidth = Math.max(1, width - paddingX * 2);
    const leftWidth = visibleWidth(display.leftText);
    const config = getRightMessagesConfig();
    const minGap = getSafeMinGap(config);
    const availableRightWidth = contentWidth - leftWidth - minGap;
    if (availableRightWidth < MIN_VISIBLE_RIGHT_MESSAGE_WIDTH) {
        return originalRender.call(loader, width);
    }

    const elapsedMs = Math.max(0, Date.now() - display.startedAt);
    const selected = selectRightMessage(config, elapsedMs, availableRightWidth);
    if (selected === undefined) {
        return originalRender.call(loader, width);
    }

    const rightMessageSegment = renderRightMessageSegment(selected, availableRightWidth, config);
    const rightWidth = visibleWidth(rightMessageSegment);
    if (rightWidth === 0) {
        return originalRender.call(loader, width);
    }

    const styledRightMessageSegment = applyRightMessageStyle(rightMessageSegment, config);
    const rightText = display.messageColorFn(styledRightMessageSegment);
    const gapWidth = Math.max(minGap, contentWidth - leftWidth - rightWidth);
    const content = `${display.leftText}${" ".repeat(gapWidth)}${rightText}`;
    const line = padLineToWidth(`${" ".repeat(paddingX)}${content}`, width);
    return ["", line];
}

function formatElapsed(seconds: number): string {
    if (seconds < 60) {
        return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
        return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

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

function updateDisplay(loader: Loader): void {
    const l = loader as unknown as LoaderInternals;
    const frame = l.frames[l.currentFrame] ?? "";
    let renderedFrame = l.spinnerColorFn(frame);
    if (l.renderIndicatorVerbatim === true) {
        renderedFrame = frame;
    }

    let indicator = "";
    if (frame.length > 0) {
        indicator = `${renderedFrame} `;
    }

    let startedAt = loaderStartTimes.get(loader);
    if (startedAt === undefined) {
        startedAt = Date.now();
        loaderStartTimes.set(loader, startedAt);
    }
    const elapsedSeconds = Math.floor(Math.max(0, Date.now() - startedAt) / 1000);
    const message = `${l.message} (${formatElapsed(elapsedSeconds)})`;
    const leftText = `${indicator}${l.messageColorFn(message)}`;

    loaderDisplays.set(loader, {
        leftText,
        messageColorFn: (text: string) => l.messageColorFn(text),
        startedAt,
    });
    l.setText(leftText);
    l.ui?.requestRender();
}

function patchLoaderTime(): void {
    const state = getPatchState();
    if ((state[LOADER_TIME_PATCH_VERSION_KEY] ?? 0) >= LOADER_TIME_PATCH_VERSION) {
        return;
    }
    const prototype = Loader.prototype as unknown as {
        start?: () => void;
        stop?: () => void;
        updateDisplay?: () => void;
        render?: (width: number) => string[];
    };
    const originalStart = Reflect.get(prototype, "start") as ((this: Loader) => void) | undefined;
    const originalStop = Reflect.get(prototype, "stop") as ((this: Loader) => void) | undefined;
    const originalUpdateDisplay = Reflect.get(prototype, "updateDisplay") as
        | ((this: Loader) => void)
        | undefined;
    const originalRender = Reflect.get(prototype, "render") as
        | ((this: Loader, width: number) => string[])
        | undefined;
    if (
        typeof originalStart !== "function" ||
        typeof originalStop !== "function" ||
        typeof originalUpdateDisplay !== "function" ||
        typeof originalRender !== "function"
    ) {
        return;
    }

    prototype.start = function patchedStart(this: Loader): void {
        loaderStartTimes.set(this, Date.now());
        originalStart.call(this);
    };

    prototype.stop = function patchedStop(this: Loader): void {
        loaderStartTimes.delete(this);
        loaderDisplays.delete(this);
        originalStop.call(this);
    };

    prototype.updateDisplay = function patchedUpdateDisplay(this: Loader): void {
        updateDisplay(this);
    };

    prototype.render = function patchedRender(this: Loader, width: number): string[] {
        const display = loaderDisplays.get(this);
        if (display === undefined) {
            return originalRender.call(this, width);
        }
        return renderDisplayWithRightMessage(this, display, width, originalRender);
    };

    state[LOADER_TIME_PATCH_KEY] = true;
    state[LOADER_TIME_PATCH_VERSION_KEY] = LOADER_TIME_PATCH_VERSION;
}

function reportConfigErrors(ctx: ExtensionContext, loaded: LoadedRunTimerConfig): void {
    for (const error of loaded.errors) {
        if (reportedConfigErrors.has(error)) {
            continue;
        }
        reportedConfigErrors.add(error);
        ctx.ui.notify(`[pi-run-timer] ${error}`, "error");
    }
}

function applyRunTimerConfig(ctx: ExtensionContext): void {
    const loaded = loadRunTimerConfig(ctx.cwd, ctx.isProjectTrusted());
    setRightMessagesConfig(loaded.config.rightMessages);
    reportConfigErrors(ctx, loaded);
}

export default function runTimerExtension(pi: ExtensionAPI): void {
    patchLoaderTime();

    let agentStartedAt: number | undefined;
    let messageStart: number | undefined;
    let streamStart: number | undefined;
    let totalOutputTokens = 0;
    let totalStreamMs = 0;

    pi.on("session_start", async (_event, ctx) => {
        applyRunTimerConfig(ctx);
        setWorkedForWidget(ctx, undefined);
    });

    pi.on("agent_start", async (_event, ctx) => {
        agentStartedAt = Date.now();
        messageStart = undefined;
        streamStart = undefined;
        totalOutputTokens = 0;
        totalStreamMs = 0;
        setWorkedForWidget(ctx, undefined);
    });

    pi.on("message_start", async (event) => {
        if (event.message.role !== "assistant") return;
        messageStart = Date.now();
        streamStart = undefined;
    });

    pi.on("message_update", async (event) => {
        if (event.message.role !== "assistant") return;

        const streamEvent = event.assistantMessageEvent;
        const isOutputDelta =
            streamEvent.type === "text_delta" ||
            streamEvent.type === "thinking_delta" ||
            streamEvent.type === "toolcall_delta";
        if (!isOutputDelta) return;

        streamStart ??= Date.now();
    });

    pi.on("message_end", async (event) => {
        if (event.message.role !== "assistant") return;

        const outputTokens = event.message.usage.output;
        const timingStart = streamStart ?? messageStart;
        if (timingStart === undefined || outputTokens <= 0) {
            messageStart = undefined;
            streamStart = undefined;
            return;
        }

        totalOutputTokens += outputTokens;
        totalStreamMs += Math.max(0, Date.now() - timingStart);

        messageStart = undefined;
        streamStart = undefined;
    });

    pi.on("agent_end", async (_event, ctx) => {
        if (agentStartedAt === undefined) return;
        const duration = Date.now() - agentStartedAt;
        const elapsedSeconds = totalStreamMs / 1000;
        let tokensPerSecond: number | undefined;
        if (totalOutputTokens > 0 && elapsedSeconds > 0) {
            tokensPerSecond = Math.round(totalOutputTokens / elapsedSeconds);
        }
        agentStartedAt = undefined;
        setWorkedForWidget(ctx, formatDuration(duration), tokensPerSecond);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        agentStartedAt = undefined;
        messageStart = undefined;
        streamStart = undefined;
        totalOutputTokens = 0;
        totalStreamMs = 0;
        setRightMessagesConfig(DEFAULT_RIGHT_MESSAGES_CONFIG);
        setWorkedForWidget(ctx, undefined);
    });
}
