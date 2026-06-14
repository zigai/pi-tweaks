import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";

import { formatDuration, setWorkedForWidget } from "./worked-for-widget.ts";

const LOADER_TIME_PATCH_KEY = Symbol.for("zigai.pi-run-timer.loader-time-patched");

const loaderStartTimes = new WeakMap<object, number>();

type PatchState = typeof globalThis & {
    [LOADER_TIME_PATCH_KEY]?: boolean;
};

function getPatchState(): PatchState {
    return globalThis as PatchState;
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
    l.setText(`${indicator}${l.messageColorFn(message)}`);
    l.ui?.requestRender();
}

function patchLoaderTime(): void {
    const state = getPatchState();
    if (state[LOADER_TIME_PATCH_KEY] === true) {
        return;
    }
    const prototype = Loader.prototype as unknown as {
        start?: () => void;
        stop?: () => void;
        updateDisplay?: () => void;
    };
    const originalStart = Reflect.get(prototype, "start") as ((this: Loader) => void) | undefined;
    const originalStop = Reflect.get(prototype, "stop") as ((this: Loader) => void) | undefined;
    const originalUpdateDisplay = Reflect.get(prototype, "updateDisplay") as
        | ((this: Loader) => void)
        | undefined;
    if (
        typeof originalStart !== "function" ||
        typeof originalStop !== "function" ||
        typeof originalUpdateDisplay !== "function"
    ) {
        return;
    }
    state[LOADER_TIME_PATCH_KEY] = true;

    prototype.start = function patchedStart(this: Loader): void {
        loaderStartTimes.set(this, Date.now());
        originalStart.call(this);
    };

    prototype.stop = function patchedStop(this: Loader): void {
        loaderStartTimes.delete(this);
        originalStop.call(this);
    };

    prototype.updateDisplay = function patchedUpdateDisplay(this: Loader): void {
        updateDisplay(this);
    };
}

export default function runTimerExtension(pi: ExtensionAPI): void {
    patchLoaderTime();

    let agentStartedAt: number | undefined;
    let messageStart: number | undefined;
    let streamStart: number | undefined;
    let totalOutputTokens = 0;
    let totalStreamMs = 0;

    pi.on("session_start", async (_event, ctx) => {
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
        setWorkedForWidget(ctx, undefined);
    });
}
