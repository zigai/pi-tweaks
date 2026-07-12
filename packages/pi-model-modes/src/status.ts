import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shouldShowThinkingLevelStatus } from "./settings.ts";

const STATUS_PATCH_MARKER = Symbol.for("zigai.pi-model-modes.thinking-status-patch");
const STATUS_PATCH_STATE = Symbol.for("zigai.pi-model-modes.thinking-status-state");
const THINKING_LEVEL_STATUS_PREFIX = "Thinking level: ";

type InteractiveModePrototype = {
    showStatus(message: string): void;
    [STATUS_PATCH_MARKER]?: true;
};

type StatusPatchRecord = {
    prototype: InteractiveModePrototype;
    originalShowStatus: ShowStatus;
    patchedShowStatus: ShowStatus;
};

type StatusPatchState = {
    shouldShowThinkingLevelStatus: () => boolean;
    patch?: StatusPatchRecord;
};

type ShowStatus = (this: InteractiveModePrototype, message: string) => void;

type ThinkingLevelStatusPatchOptions = {
    readonly loadInteractiveModeModule?: () => Promise<unknown>;
    readonly shouldShowThinkingLevelStatus?: () => boolean;
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function isInteractiveModePrototype(value: unknown): value is InteractiveModePrototype {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return false;
    }
    return typeof getUnknownProperty(value, "showStatus") === "function";
}

function isStatusPatchRecord(value: unknown): value is StatusPatchRecord {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return false;
    }
    return (
        isInteractiveModePrototype(getUnknownProperty(value, "prototype")) &&
        typeof getUnknownProperty(value, "originalShowStatus") === "function" &&
        typeof getUnknownProperty(value, "patchedShowStatus") === "function"
    );
}

function isStatusPatchState(value: unknown): value is StatusPatchState {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return false;
    }
    if (typeof getUnknownProperty(value, "shouldShowThinkingLevelStatus") !== "function") {
        return false;
    }
    const patch = getUnknownProperty(value, "patch");
    return patch === undefined || isStatusPatchRecord(patch);
}

function getStatusPatchState(): StatusPatchState {
    const existing: unknown = Reflect.get(globalThis, STATUS_PATCH_STATE) as unknown;
    if (isStatusPatchState(existing)) return existing;

    const patchState: StatusPatchState = {
        shouldShowThinkingLevelStatus: () => true,
    };
    Reflect.set(globalThis, STATUS_PATCH_STATE, patchState);
    return patchState;
}

function warnStatusPatchUnavailable(error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(
        `[pi-model-modes] thinking-level status patch unavailable; Pi internals may have changed${suffix}`,
    );
}

export function restoreThinkingLevelStatusPatch(): void {
    const patchState = getStatusPatchState();
    const patch = patchState.patch;
    if (patch === undefined) {
        return;
    }

    if (patch.prototype.showStatus === patch.patchedShowStatus) {
        patch.prototype.showStatus = patch.originalShowStatus;
    }
    delete patch.prototype[STATUS_PATCH_MARKER];
    patchState.patch = undefined;
}

async function loadInteractiveModeModule(): Promise<unknown> {
    try {
        const codingAgentEntry = fileURLToPath(
            import.meta.resolve("@earendil-works/pi-coding-agent"),
        );
        const distDir = dirname(codingAgentEntry);
        const interactiveModePath = pathToFileURL(
            join(distDir, "modes/interactive/interactive-mode.js"),
        ).href;
        return (await import(interactiveModePath)) as unknown;
    } catch (error: unknown) {
        warnStatusPatchUnavailable(error);
        return undefined;
    }
}

export async function applyThinkingLevelStatusPatch(
    options: ThinkingLevelStatusPatchOptions = {},
): Promise<void> {
    const patchState = getStatusPatchState();
    patchState.shouldShowThinkingLevelStatus =
        options.shouldShowThinkingLevelStatus ?? shouldShowThinkingLevelStatus;

    const loadModule = options.loadInteractiveModeModule ?? loadInteractiveModeModule;
    const module = await loadModule();
    const interactiveMode = getUnknownProperty(module, "InteractiveMode");
    const prototypeValue = getUnknownProperty(interactiveMode, "prototype");
    if (!isInteractiveModePrototype(prototypeValue)) {
        warnStatusPatchUnavailable(new Error("InteractiveMode.showStatus is not a function"));
        return;
    }
    const prototype = prototypeValue;
    if (patchState.patch !== undefined && patchState.patch.prototype !== prototype) {
        restoreThinkingLevelStatusPatch();
    }
    if (prototype[STATUS_PATCH_MARKER] === true) return;

    const showStatusDescriptor = Object.getOwnPropertyDescriptor(prototype, "showStatus");
    const showStatus: unknown = showStatusDescriptor?.value;
    if (typeof showStatus !== "function") {
        warnStatusPatchUnavailable(new Error("InteractiveMode.showStatus descriptor is invalid"));
        return;
    }

    // SAFETY: The immediately preceding descriptor check proves the private showStatus seam is callable.
    const typedShowStatus = showStatus as ShowStatus;
    const patchedShowStatus = function patchedShowStatus(
        this: InteractiveModePrototype,
        message: string,
    ): void {
        if (
            message.startsWith(THINKING_LEVEL_STATUS_PREFIX) &&
            patchState.shouldShowThinkingLevelStatus() === false
        ) {
            return;
        }
        typedShowStatus.call(this, message);
    };
    prototype.showStatus = patchedShowStatus;
    prototype[STATUS_PATCH_MARKER] = true;
    patchState.patch = {
        prototype,
        originalShowStatus: typedShowStatus,
        patchedShowStatus,
    };
}
