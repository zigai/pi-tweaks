import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
    installLinkedMethodPatch,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

const MODEL_STATUS_PATCH = Symbol.for("zigai.pi-ui-tweaks.model-status-patch");

export type ModelStatusConfig = { readonly hideModelChangeStatus: boolean };
export type ModelStatusHandle = { update(config: ModelStatusConfig): void; dispose(): void };

type ShowStatus = (this: InteractiveModeStatusTarget, message: string) => void;
type InteractiveModeStatusTarget = {
    showStatus: ShowStatus;
    ui: { requestRender(force?: boolean): void };
    [MODEL_STATUS_PATCH]?: ModelStatusPatchRecord;
};
type ModelStatusPatchRecord = {
    readonly original: ShowStatus;
    readonly patch: LinkedMethodPatchHandle<InteractiveModeStatusTarget, [string], void>;
    readonly handle: ModelStatusHandle;
};

function warnModelStatusPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined) suffix = `: ${reason}`;
    console.warn(
        `[pi-ui-tweaks] model status patch unavailable; Pi internals may have changed${suffix}`,
    );
}
function isModelChangeStatus(message: string): boolean {
    return /^Model: \S/.test(message);
}
function inactiveModelStatusHandle(): ModelStatusHandle {
    return { update(): void {}, dispose(): void {} };
}

/** Installs or updates the model-change status patch. */
export function installModelStatusPatch(
    config: ModelStatusConfig,
    target: unknown = InteractiveMode.prototype,
): ModelStatusHandle {
    if ((typeof target !== "object" && typeof target !== "function") || target === null) {
        warnModelStatusPatchUnavailable();
        return inactiveModelStatusHandle();
    }
    const showStatus: unknown = Reflect.get(target, "showStatus");
    if (typeof showStatus !== "function") {
        warnModelStatusPatchUnavailable("missing showStatus");
        return inactiveModelStatusHandle();
    }
    // SAFETY: The runtime guard proves the private InteractiveMode method is callable.
    const prototype = target as InteractiveModeStatusTarget;
    const installed = prototype[MODEL_STATUS_PATCH];
    if (installed !== undefined) {
        installed.handle.update(config);
        return installed.handle;
    }
    let current = config;
    const patch = installLinkedMethodPatch(
        prototype,
        "showStatus",
        (predecessor) =>
            function patchedShowStatus(this: InteractiveModeStatusTarget, message: string): void {
                if (current.hideModelChangeStatus && isModelChangeStatus(message)) {
                    this.ui.requestRender();
                    return;
                }
                predecessor.call(this, message);
            },
    );
    let disposed = false;
    const handle: ModelStatusHandle = {
        update(next): void {
            if (!disposed) current = next;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            patch.dispose();
            if (prototype[MODEL_STATUS_PATCH]?.handle === handle)
                delete prototype[MODEL_STATUS_PATCH];
        },
    };
    prototype[MODEL_STATUS_PATCH] = { original: patch.predecessor, patch, handle };
    return handle;
}
