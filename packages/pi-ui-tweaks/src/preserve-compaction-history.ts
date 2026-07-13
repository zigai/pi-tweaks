import { InteractiveMode } from "@earendil-works/pi-coding-agent";

import { getUiTweaksPatchState } from "./patch-state.ts";

const PRESERVE_COMPACTION_HISTORY_PATCH_KEY = Symbol.for(
    "zigai.pi-ui-tweaks.preserve-compaction-history-patched",
);

type CompactionEvent = {
    readonly type?: unknown;
    readonly aborted?: unknown;
    readonly result?: unknown;
};

type ChatContainer = {
    clear: () => void;
};

type InteractiveModeCompactionTarget = {
    [PRESERVE_COMPACTION_HISTORY_PATCH_KEY]?: true;
    chatContainer: ChatContainer;
    handleEvent: (event: unknown) => Promise<void>;
    rebuildChatFromMessages: () => void;
};

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isSuccessfulCompaction(event: unknown): event is CompactionEvent {
    if (!isObject(event)) {
        return false;
    }

    return (
        Reflect.get(event, "type") === "compaction_end" &&
        Reflect.get(event, "aborted") === false &&
        Reflect.get(event, "result") !== undefined
    );
}

function isInteractiveModeCompactionTarget(
    value: unknown,
): value is InteractiveModeCompactionTarget {
    if (!isObject(value)) {
        return false;
    }

    const chatContainer: unknown = Reflect.get(value, "chatContainer") as unknown;
    return (
        isObject(chatContainer) &&
        typeof Reflect.get(chatContainer, "clear") === "function" &&
        typeof Reflect.get(value, "rebuildChatFromMessages") === "function"
    );
}

function warnPreserveCompactionHistoryPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined && reason.length > 0) {
        suffix = `: ${reason}`;
    }

    console.warn(
        `[pi-ui-tweaks] preserve compaction history patch unavailable; Pi internals may have changed${suffix}`,
    );
}

/**
 * Sets whether successful live compactions retain the existing rendered transcript.
 */
export function setPreserveCompactionHistory(enabled: boolean): void {
    getUiTweaksPatchState().preserveCompactionHistory = enabled;
}

/**
 * Installs an idempotent patch that preserves rendered history during live compaction.
 */
export function installPreserveCompactionHistoryPatch(prototype?: unknown): void {
    const prototypeValue: unknown = prototype ?? InteractiveMode.prototype;
    if (!isObject(prototypeValue)) {
        warnPreserveCompactionHistoryPatchUnavailable();
        return;
    }

    const originalHandleEventValue: unknown = Reflect.get(prototypeValue, "handleEvent") as unknown;
    if (typeof originalHandleEventValue !== "function") {
        warnPreserveCompactionHistoryPatchUnavailable("missing handleEvent");
        return;
    }

    // SAFETY: The runtime guard verifies the prototype method before the private
    // InteractiveMode adapter is narrowed to the patch target.
    const targetPrototype = prototypeValue as InteractiveModeCompactionTarget;
    if (targetPrototype[PRESERVE_COMPACTION_HISTORY_PATCH_KEY] === true) {
        return;
    }

    // SAFETY: InteractiveMode.handleEvent is an async runtime method. The wrapper
    // forwards its event unchanged and restores temporary method replacements.
    const originalHandleEvent =
        originalHandleEventValue as InteractiveModeCompactionTarget["handleEvent"];

    targetPrototype.handleEvent = async function patchedHandleEvent(
        this: InteractiveModeCompactionTarget,
        event: unknown,
    ): Promise<void> {
        if (
            !getUiTweaksPatchState().preserveCompactionHistory ||
            !isSuccessfulCompaction(event) ||
            !isInteractiveModeCompactionTarget(this)
        ) {
            return originalHandleEvent.call(this, event);
        }

        const originalClear = this.chatContainer.clear;
        const originalRebuildChatFromMessages = this.rebuildChatFromMessages;
        this.chatContainer.clear = () => {};
        this.rebuildChatFromMessages = () => {};

        try {
            await originalHandleEvent.call(this, event);
        } finally {
            this.chatContainer.clear = originalClear;
            this.rebuildChatFromMessages = originalRebuildChatFromMessages;
        }
    };

    targetPrototype[PRESERVE_COMPACTION_HISTORY_PATCH_KEY] = true;
}
