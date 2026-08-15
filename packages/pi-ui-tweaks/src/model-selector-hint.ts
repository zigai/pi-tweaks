import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import {
    installLinkedMethodPatch,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

const MODEL_PROVIDER_HINT_TEXT =
    "Only showing models from configured providers. Use /login to add providers.";
const MODEL_SELECTOR_HINT_PATCH = Symbol.for("zigai.pi-ui-tweaks.model-selector-hint-patch");
const selectorInstancesSkippingNextSpacer = new WeakSet<object>();

export type ModelSelectorHintConfig = {
    readonly compactModelSelector: boolean;
    readonly hideModelProviderHint: boolean;
};
export type ModelSelectorHintHandle = {
    update(config: ModelSelectorHintConfig): void;
    dispose(): void;
};

type ComponentLike = { render(width: number): string[]; invalidate(): void };
type AddChild = (this: ModelSelectorAddChildTarget, component: ComponentLike) => void;
type ModelSelectorAddChildTarget = {
    addChild: AddChild;
    [MODEL_SELECTOR_HINT_PATCH]?: ModelSelectorHintPatchRecord;
};
type ModelSelectorHintPatchRecord = {
    readonly original: AddChild;
    readonly patch: LinkedMethodPatchHandle<ModelSelectorAddChildTarget, [ComponentLike], void>;
    readonly handle: ModelSelectorHintHandle;
};

function warnModelSelectorHintPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined) suffix = `: ${reason}`;
    console.warn(
        `[pi-ui-tweaks] model picker hint patch unavailable; Pi internals may have changed${suffix}`,
    );
}
function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}
function getUnknownProperty(value: object, key: PropertyKey): unknown {
    return Reflect.get(value, key);
}
function isSingleLineSpacer(component: ComponentLike): boolean {
    if (getUnknownProperty(component, "lines") !== 1) return false;
    const constructorValue = getUnknownProperty(component, "constructor");
    return isObject(constructorValue) && getUnknownProperty(constructorValue, "name") === "Spacer";
}
function isModelProviderHintText(component: ComponentLike): boolean {
    const text = getUnknownProperty(component, "text");
    return typeof text === "string" && text.includes(MODEL_PROVIDER_HINT_TEXT);
}

/** Installs or updates the model-selector hint patch. */
export function installModelSelectorHintPatch(
    config: ModelSelectorHintConfig,
    target: unknown = ModelSelectorComponent.prototype,
): ModelSelectorHintHandle {
    if ((typeof target !== "object" && typeof target !== "function") || target === null) {
        warnModelSelectorHintPatchUnavailable();
        return { update(): void {}, dispose(): void {} };
    }
    const addChild: unknown = Reflect.get(target, "addChild");
    if (typeof addChild !== "function") {
        warnModelSelectorHintPatchUnavailable("missing addChild");
        return { update(): void {}, dispose(): void {} };
    }
    // SAFETY: The runtime guard proves the inherited Container.addChild seam is callable.
    const prototype = target as ModelSelectorAddChildTarget;
    const installed = prototype[MODEL_SELECTOR_HINT_PATCH];
    if (installed !== undefined) {
        installed.handle.update(config);
        return installed.handle;
    }
    let current = config;
    const patch = installLinkedMethodPatch(
        prototype,
        "addChild",
        (predecessor) =>
            function patchedModelSelectorAddChild(
                this: ModelSelectorAddChildTarget,
                component: ComponentLike,
            ): void {
                if (selectorInstancesSkippingNextSpacer.has(this)) {
                    selectorInstancesSkippingNextSpacer.delete(this);
                    if (isSingleLineSpacer(component)) return;
                }
                if (current.compactModelSelector && isSingleLineSpacer(component)) return;
                if (current.hideModelProviderHint && isModelProviderHintText(component)) {
                    selectorInstancesSkippingNextSpacer.add(this);
                    return;
                }
                predecessor.call(this, component);
            },
    );
    let disposed = false;
    const handle: ModelSelectorHintHandle = {
        update(next): void {
            if (!disposed) current = next;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            patch.dispose();
            if (prototype[MODEL_SELECTOR_HINT_PATCH]?.handle === handle) {
                delete prototype[MODEL_SELECTOR_HINT_PATCH];
            }
        },
    };
    prototype[MODEL_SELECTOR_HINT_PATCH] = { original: patch.predecessor, patch, handle };
    return handle;
}
