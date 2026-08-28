import {
    loadPiInternalModule,
    warnPiInternalPatchUnavailable,
} from "@zigai/pi-extension-internals";

export function warnProviderDisplayPatchUnavailable(feature: string, cause?: unknown): void {
    warnPiInternalPatchUnavailable("pi-model-alias", feature, cause);
}

export type ScopedModelsSelectorPrototypeCandidate = {
    updateList?: unknown;
};

type ScopedModelsSelectorModule = {
    ScopedModelsSelectorComponent: {
        prototype: ScopedModelsSelectorPrototypeCandidate;
    };
};

function isScopedModelsSelectorModule(value: unknown): value is ScopedModelsSelectorModule {
    if (typeof value !== "object" || value === null) return false;
    if (!("ScopedModelsSelectorComponent" in value)) return false;
    const component = value.ScopedModelsSelectorComponent;
    if (
        ((typeof component !== "object" || component === null) &&
            typeof component !== "function") ||
        !("prototype" in component)
    ) {
        return false;
    }
    return typeof component.prototype === "object" && component.prototype !== null;
}

export async function loadScopedModelsSelectorPrototype<T>(
    parsePrototype: (value: ScopedModelsSelectorPrototypeCandidate) => T | undefined,
): Promise<T | undefined> {
    return loadPiInternalModule("modes/interactive/components/scoped-models-selector.js", {
        scope: "pi-model-alias",
        feature: "scoped models provider alias patch",
        parse(module) {
            if (!isScopedModelsSelectorModule(module)) return undefined;
            return parsePrototype(module.ScopedModelsSelectorComponent.prototype);
        },
    });
}
