import { InteractiveMode } from "@earendil-works/pi-coding-agent";

const MODEL_STATUS_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.model-status-patched");

let hideModelChangeStatus = true;

type ShowStatus = (this: InteractiveModeStatusTarget, message: string) => void;

type InteractiveModeStatusTarget = {
    [MODEL_STATUS_PATCH_KEY]?: true;
    showStatus: ShowStatus;
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
    hideModelChangeStatus = enabled;
}

/**
 * Installs an idempotent patch that suppresses Pi's redundant model-change status line.
 */
export function installModelStatusPatch(
    prototype: InteractiveModeStatusTarget = InteractiveMode.prototype as unknown as InteractiveModeStatusTarget,
): void {
    if (prototype[MODEL_STATUS_PATCH_KEY] === true) {
        return;
    }

    const originalShowStatusValue: unknown = Reflect.get(prototype, "showStatus");
    if (typeof originalShowStatusValue !== "function") {
        warnModelStatusPatchUnavailable("missing showStatus");
        return;
    }

    // SAFETY: InteractiveMode exposes showStatus at runtime even though its declaration is private;
    // the runtime guard above verifies the method exists before this patch wraps it.
    const originalShowStatus = originalShowStatusValue as ShowStatus;

    prototype.showStatus = function patchedShowStatus(
        this: InteractiveModeStatusTarget,
        message: string,
    ): void {
        if (hideModelChangeStatus && isModelChangeStatus(message)) {
            return;
        }

        originalShowStatus.call(this, message);
    };

    prototype[MODEL_STATUS_PATCH_KEY] = true;
}
