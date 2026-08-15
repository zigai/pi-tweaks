import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
    installLinkedMethodPatch,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

const PRESERVE_COMPACTION_HISTORY_PATCH = Symbol.for(
    "zigai.pi-ui-tweaks.preserve-compaction-history-patch",
);
export type PreserveCompactionHistoryConfig = { readonly preserveCompactionHistory: boolean };
export type PreserveCompactionHistoryHandle = {
    update(config: PreserveCompactionHistoryConfig): void;
    dispose(): void;
};
type CompactionEvent = {
    readonly type?: unknown;
    readonly aborted?: unknown;
    readonly result?: unknown;
};
type ChatContainer = { clear: () => void };
type HandleEvent = (this: InteractiveModeCompactionTarget, event: unknown) => Promise<void>;
type InteractiveModeCompactionTarget = {
    chatContainer: ChatContainer;
    handleEvent: HandleEvent;
    rebuildChatFromMessages: () => void;
    [PRESERVE_COMPACTION_HISTORY_PATCH]?: PreserveCompactionHistoryRecord;
};
type PreserveCompactionHistoryRecord = {
    readonly original: HandleEvent;
    readonly patch: LinkedMethodPatchHandle<
        InteractiveModeCompactionTarget,
        [unknown],
        Promise<void>
    >;
    readonly handle: PreserveCompactionHistoryHandle;
};
function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}
function isSuccessfulCompaction(event: unknown): event is CompactionEvent {
    return (
        isObject(event) &&
        Reflect.get(event, "type") === "compaction_end" &&
        Reflect.get(event, "aborted") === false &&
        Reflect.get(event, "result") !== undefined
    );
}
function isInteractiveModeCompactionTarget(
    value: unknown,
): value is InteractiveModeCompactionTarget {
    if (!isObject(value)) return false;
    const chatContainer: unknown = Reflect.get(value, "chatContainer");
    return (
        isObject(chatContainer) &&
        typeof Reflect.get(chatContainer, "clear") === "function" &&
        typeof Reflect.get(value, "rebuildChatFromMessages") === "function"
    );
}
function warnPreserveCompactionHistoryPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined) suffix = `: ${reason}`;
    console.warn(
        `[pi-ui-tweaks] preserve compaction history patch unavailable; Pi internals may have changed${suffix}`,
    );
}

/** Installs or updates the live-compaction transcript-preservation patch. */
export function installPreserveCompactionHistoryPatch(
    config: PreserveCompactionHistoryConfig,
    target: unknown = InteractiveMode.prototype,
): PreserveCompactionHistoryHandle {
    if (!isObject(target) || typeof Reflect.get(target, "handleEvent") !== "function") {
        warnPreserveCompactionHistoryPatchUnavailable("missing handleEvent");
        return { update(): void {}, dispose(): void {} };
    }
    // SAFETY: The runtime guard proves handleEvent is callable.
    const prototype = target as InteractiveModeCompactionTarget;
    const installed = prototype[PRESERVE_COMPACTION_HISTORY_PATCH];
    if (installed !== undefined) {
        installed.handle.update(config);
        return installed.handle;
    }
    let current = config;
    const patch = installLinkedMethodPatch(
        prototype,
        "handleEvent",
        (predecessor) =>
            async function patchedHandleEvent(
                this: InteractiveModeCompactionTarget,
                event: unknown,
            ): Promise<void> {
                if (
                    !current.preserveCompactionHistory ||
                    !isSuccessfulCompaction(event) ||
                    !isInteractiveModeCompactionTarget(this)
                )
                    return predecessor.call(this, event);
                const originalClear = this.chatContainer.clear;
                const originalRebuild = this.rebuildChatFromMessages;
                this.chatContainer.clear = () => {};
                this.rebuildChatFromMessages = () => {};
                try {
                    await predecessor.call(this, event);
                } finally {
                    this.chatContainer.clear = originalClear;
                    this.rebuildChatFromMessages = originalRebuild;
                }
            },
    );
    let disposed = false;
    const handle: PreserveCompactionHistoryHandle = {
        update(next): void {
            if (!disposed) current = next;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            patch.dispose();
            if (prototype[PRESERVE_COMPACTION_HISTORY_PATCH]?.handle === handle) {
                delete prototype[PRESERVE_COMPACTION_HISTORY_PATCH];
            }
        },
    };
    prototype[PRESERVE_COMPACTION_HISTORY_PATCH] = { original: patch.predecessor, patch, handle };
    return handle;
}
