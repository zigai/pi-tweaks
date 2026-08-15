import {
    loadPiInternalModule,
    warnPiInternalPatchUnavailable,
} from "@zigai/pi-extension-internals";

export function warnProviderDisplayPatchUnavailable(feature: string, cause?: unknown): void {
    warnPiInternalPatchUnavailable("pi-model-alias", feature, cause);
}

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

export async function loadScopedModelsSelectorPrototype<T>(
    parsePrototype: (value: unknown) => T | undefined,
): Promise<T | undefined> {
    return loadPiInternalModule("modes/interactive/components/scoped-models-selector.js", {
        scope: "pi-model-alias",
        feature: "scoped models provider alias patch",
        parse(module) {
            const component = getUnknownProperty(module, "ScopedModelsSelectorComponent");
            return parsePrototype(getUnknownProperty(component, "prototype"));
        },
    });
}
