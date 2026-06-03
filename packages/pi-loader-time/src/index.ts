import { Loader } from "@earendil-works/pi-tui";

const LOADER_TIME_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.loader-time-patched");

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
    state[LOADER_TIME_PATCH_KEY] = true;

    const prototype = Loader.prototype as unknown as {
        start(): void;
        stop(): void;
        updateDisplay(): void;
    };
    const originalStart = Reflect.get(prototype, "start") as (this: Loader) => void;
    const originalStop = Reflect.get(prototype, "stop") as (this: Loader) => void;

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

export default function loaderTimeExtension(): void {
    patchLoaderTime();
}
