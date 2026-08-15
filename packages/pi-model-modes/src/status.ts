import {
    installLinkedMethodPatch,
    loadPiInternalModule,
    warnPiInternalPatchUnavailable,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

const STATUS_PATCH_MARKER = Symbol.for("zigai.pi-model-modes.thinking-status-patch");
const THINKING_LEVEL_STATUS_PREFIX = "Thinking level: ";
const PATCH_SCOPE = "pi-model-modes";
const PATCH_FEATURE = "thinking-level status patch";

type InteractiveModePrototype = {
    showStatus(message: string): void;
    [STATUS_PATCH_MARKER]?: StatusPatchState;
};

type ShowStatus = (this: InteractiveModePrototype, message: string) => void;

type StatusPatchState = {
    readonly predicate: { current: () => boolean };
    readonly handle: LinkedMethodPatchHandle<InteractiveModePrototype, [message: string], void>;
};

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

function isStatusPatchState(value: unknown): value is StatusPatchState {
    const predicate = getUnknownProperty(value, "predicate");
    const handle = getUnknownProperty(value, "handle");
    return (
        typeof getUnknownProperty(predicate, "current") === "function" &&
        typeof getUnknownProperty(handle, "dispose") === "function"
    );
}

function parseInteractiveModePrototype(module: unknown): InteractiveModePrototype | undefined {
    const interactiveMode = getUnknownProperty(module, "InteractiveMode");
    const prototype = getUnknownProperty(interactiveMode, "prototype");
    if (
        ((typeof prototype === "object" && prototype !== null) ||
            typeof prototype === "function") &&
        typeof getUnknownProperty(prototype, "showStatus") === "function"
    ) {
        return prototype as InteractiveModePrototype;
    }
    return undefined;
}

async function loadInteractiveModePrototype(): Promise<InteractiveModePrototype | undefined> {
    return loadPiInternalModule("modes/interactive/interactive-mode.js", {
        scope: PATCH_SCOPE,
        feature: PATCH_FEATURE,
        parse: parseInteractiveModePrototype,
    });
}

export function restoreThinkingLevelStatusPatch(prototype?: InteractiveModePrototype): void {
    if (prototype === undefined) return;
    const state: unknown = prototype[STATUS_PATCH_MARKER];
    if (!isStatusPatchState(state)) {
        delete prototype[STATUS_PATCH_MARKER];
        return;
    }
    state.handle.dispose();
    delete prototype[STATUS_PATCH_MARKER];
}

export async function applyThinkingLevelStatusPatch(
    options: ThinkingLevelStatusPatchOptions = {},
): Promise<() => void> {
    let prototype: InteractiveModePrototype | undefined;
    if (options.loadInteractiveModeModule === undefined) {
        prototype = await loadInteractiveModePrototype();
    } else {
        prototype = parseInteractiveModePrototype(await options.loadInteractiveModeModule());
    }
    if (prototype === undefined) {
        if (options.loadInteractiveModeModule !== undefined) {
            warnPiInternalPatchUnavailable(PATCH_SCOPE, PATCH_FEATURE);
        }
        return () => {};
    }

    const existing: unknown = prototype[STATUS_PATCH_MARKER];
    if (isStatusPatchState(existing)) {
        existing.predicate.current =
            options.shouldShowThinkingLevelStatus ?? existing.predicate.current;
        return () => restoreThinkingLevelStatusPatch(prototype);
    }
    if (existing !== undefined) {
        delete prototype[STATUS_PATCH_MARKER];
    }

    const predicate = {
        current: options.shouldShowThinkingLevelStatus ?? (() => true),
    };
    const handle = installLinkedMethodPatch(
        prototype,
        "showStatus",
        (predecessor): ShowStatus =>
            function patchedShowStatus(message: string): void {
                if (
                    message.startsWith(THINKING_LEVEL_STATUS_PREFIX) &&
                    predicate.current() === false
                ) {
                    return;
                }
                predecessor.call(this, message);
            },
    );
    prototype[STATUS_PATCH_MARKER] = { predicate, handle };
    return () => restoreThinkingLevelStatusPatch(prototype);
}
