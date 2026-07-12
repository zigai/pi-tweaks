import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";

import { getUiTweaksPatchState } from "./patch-state.ts";

const MODEL_PROVIDER_HINT_TEXT =
    "Only showing models from configured providers. Use /login to add providers.";
const MODEL_SELECTOR_HINT_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.model-selector-hint-patched");

const selectorInstancesSkippingNextSpacer = new WeakSet<object>();

type ComponentLike = {
    render(width: number): string[];
    invalidate(): void;
};

type AddChild = (this: ModelSelectorAddChildTarget, component: ComponentLike) => void;

type ModelSelectorAddChildTarget = {
    [MODEL_SELECTOR_HINT_PATCH_KEY]?: true;
    addChild: AddChild;
};

function warnModelSelectorHintPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined && reason.length > 0) {
        suffix = `: ${reason}`;
    }

    console.warn(
        `[pi-ui-tweaks] model picker hint patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function getUnknownProperty(value: object, key: PropertyKey): unknown {
    return Reflect.get(value, key) as unknown;
}

function isSingleLineSpacer(component: ComponentLike): boolean {
    const lines = getUnknownProperty(component, "lines");
    if (lines !== 1) {
        return false;
    }

    const constructorValue = getUnknownProperty(component, "constructor");
    if (!isObject(constructorValue)) {
        return false;
    }

    return getUnknownProperty(constructorValue, "name") === "Spacer";
}

function isModelProviderHintText(component: ComponentLike): boolean {
    const text = getUnknownProperty(component, "text");
    return typeof text === "string" && text.includes(MODEL_PROVIDER_HINT_TEXT);
}

/**
 * Sets whether extra model picker blank spacer rows should be hidden.
 */
export function setCompactModelSelector(enabled: boolean): void {
    getUiTweaksPatchState().compactModelSelector = enabled;
}

/**
 * Sets whether the configured-provider model picker hint should be hidden.
 */
export function setHideModelProviderHint(enabled: boolean): void {
    getUiTweaksPatchState().hideModelProviderHint = enabled;
}

/**
 * Installs an idempotent patch that removes Pi's configured-provider hint from the model picker.
 */
export function installModelSelectorHintPatch(
    prototype: ModelSelectorAddChildTarget = ModelSelectorComponent.prototype,
): void {
    if (prototype[MODEL_SELECTOR_HINT_PATCH_KEY] === true) {
        return;
    }

    const originalAddChildValue: unknown = Reflect.get(prototype, "addChild");
    if (typeof originalAddChildValue !== "function") {
        warnModelSelectorHintPatchUnavailable("missing addChild");
        return;
    }

    // SAFETY: ModelSelectorComponent inherits Container.addChild with this signature; the
    // runtime guard above confirms the method exists before this patch wraps it.
    const originalAddChild = originalAddChildValue as AddChild;

    prototype.addChild = function patchedModelSelectorAddChild(
        this: ModelSelectorAddChildTarget,
        component: ComponentLike,
    ): void {
        if (selectorInstancesSkippingNextSpacer.has(this)) {
            selectorInstancesSkippingNextSpacer.delete(this);
            if (isSingleLineSpacer(component)) {
                return;
            }
        }

        const patchState = getUiTweaksPatchState();
        if (patchState.compactModelSelector && isSingleLineSpacer(component)) {
            return;
        }

        if (patchState.hideModelProviderHint && isModelProviderHintText(component)) {
            selectorInstancesSkippingNextSpacer.add(this);
            return;
        }

        originalAddChild.call(this, component);
    };

    prototype[MODEL_SELECTOR_HINT_PATCH_KEY] = true;
}
