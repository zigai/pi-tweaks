import { InteractiveMode } from "@earendil-works/pi-coding-agent";

import { getUiTweaksPatchState } from "./patch-state.ts";

const MODEL_STATUS_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.model-status-patched");

type ShowStatus = (this: InteractiveModeStatusTarget, message: string) => void;

type InteractiveModeStatusTarget = {
    [MODEL_STATUS_PATCH_KEY]?: true;
    showStatus: ShowStatus;
    ui: { requestRender(force?: boolean): void };
};

function warnModelStatusPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined && reason.length > 0) {
        suffix = `: ${reason}`;
    }

    console.warn(
        `[pi-ui-tweaks] model status patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function isModelChangeStatus(message: string): boolean {
    return /^Model: \S/.test(message);
}

/**
 * Sets whether redundant model-change status lines should be hidden.
 */
export function setHideModelChangeStatus(enabled: boolean): void {
    getUiTweaksPatchState().hideModelChangeStatus = enabled;
}

/**
 * Installs an idempotent patch that suppresses Pi's redundant model-change status line.
 */
export function installModelStatusPatch(prototype?: InteractiveModeStatusTarget): void {
    const prototypeValue: unknown = prototype ?? InteractiveMode.prototype;
    if (
        (typeof prototypeValue !== "object" && typeof prototypeValue !== "function") ||
        prototypeValue === null
    ) {
        warnModelStatusPatchUnavailable();
        return;
    }
    const originalShowStatusValue: unknown = Reflect.get(prototypeValue, "showStatus") as unknown;
    if (typeof originalShowStatusValue !== "function") {
        warnModelStatusPatchUnavailable("missing showStatus");
        return;
    }
    // SAFETY: The guarded Pi InteractiveMode adapter verifies the private method
    // before exposing the smallest model-status patch target.
    prototype = prototypeValue as InteractiveModeStatusTarget;
    if (prototype[MODEL_STATUS_PATCH_KEY] === true) {
        return;
    }

    // SAFETY: InteractiveMode exposes showStatus at runtime even though its declaration is private;
    // the runtime guard above verifies the method exists before this patch wraps it.
    const originalShowStatus = originalShowStatusValue as ShowStatus;

    prototype.showStatus = function patchedShowStatus(
        this: InteractiveModeStatusTarget,
        message: string,
    ): void {
        if (getUiTweaksPatchState().hideModelChangeStatus && isModelChangeStatus(message)) {
            // Model selection restores the editor immediately before this call. Preserve the
            // original method's repaint even though the status line itself is suppressed.
            this.ui.requestRender();
            return;
        }

        originalShowStatus.call(this, message);
    };

    prototype[MODEL_STATUS_PATCH_KEY] = true;
}
