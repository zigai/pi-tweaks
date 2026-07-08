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

type InteractiveModeClass = {
    prototype: InteractiveModePrototype;
};

type InteractiveModeModule = {
    InteractiveMode?: InteractiveModeClass;
};

type ShowStatus = (this: InteractiveModePrototype, message: string) => void;

type ThinkingLevelStatusPatchOptions = {
    readonly loadInteractiveModeModule?: () => Promise<InteractiveModeModule | undefined>;
    readonly shouldShowThinkingLevelStatus?: () => boolean;
};

function isShowStatus(value: unknown): value is ShowStatus {
    return typeof value === "function";
}

function getStatusPatchState(): StatusPatchState {
    const existing = Reflect.get(globalThis, STATUS_PATCH_STATE);
    if (typeof existing === "object" && existing !== null) {
        const reader = Reflect.get(existing, "shouldShowThinkingLevelStatus");
        if (typeof reader === "function") {
            return existing as StatusPatchState;
        }
    }

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

async function loadInteractiveModeModule(): Promise<InteractiveModeModule | undefined> {
    try {
        const codingAgentEntry = fileURLToPath(
            import.meta.resolve("@earendil-works/pi-coding-agent"),
        );
        const distDir = dirname(codingAgentEntry);
        const interactiveModePath = pathToFileURL(
            join(distDir, "modes/interactive/interactive-mode.js"),
        ).href;
        return (await import(interactiveModePath)) as InteractiveModeModule;
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
    const prototype = module?.InteractiveMode?.prototype;
    if (prototype === undefined) return;
    if (patchState.patch !== undefined && patchState.patch.prototype !== prototype) {
        restoreThinkingLevelStatusPatch();
    }
    if (prototype[STATUS_PATCH_MARKER] === true) return;
    if (typeof prototype.showStatus !== "function") {
        warnStatusPatchUnavailable(new Error("InteractiveMode.showStatus is not a function"));
        return;
    }

    const showStatusDescriptor = Object.getOwnPropertyDescriptor(prototype, "showStatus");
    const showStatus: unknown = showStatusDescriptor?.value;
    if (!isShowStatus(showStatus)) {
        warnStatusPatchUnavailable(new Error("InteractiveMode.showStatus descriptor is invalid"));
        return;
    }

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
        showStatus.call(this, message);
    };
    prototype.showStatus = patchedShowStatus;
    prototype[STATUS_PATCH_MARKER] = true;
    patchState.patch = {
        prototype,
        originalShowStatus: showStatus,
        patchedShowStatus,
    };
}
