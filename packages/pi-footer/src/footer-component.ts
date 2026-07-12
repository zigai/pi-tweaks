export const FOOTER_COMPONENT_MARKER = Symbol.for("zigai.pi-footer.component");
export const FOOTER_COMPONENT_KIND = Symbol.for("zigai.pi-footer.component-kind");

export type FooterComponentKind = "live" | "bridge";

export type MarkedFooterComponent = {
    [FOOTER_COMPONENT_MARKER]: true;
    [FOOTER_COMPONENT_KIND]: FooterComponentKind;
};

function isObject(value: unknown): value is object {
    return typeof value === "object" && value !== null;
}

export function markFooterComponent<T extends object>(
    component: T,
    kind: FooterComponentKind,
): T & MarkedFooterComponent {
    Object.defineProperty(component, FOOTER_COMPONENT_MARKER, {
        configurable: false,
        enumerable: false,
        value: true,
    });
    Object.defineProperty(component, FOOTER_COMPONENT_KIND, {
        configurable: true,
        enumerable: false,
        value: kind,
    });
    if (
        Reflect.get(component, FOOTER_COMPONENT_MARKER) !== true ||
        Reflect.get(component, FOOTER_COMPONENT_KIND) !== kind
    ) {
        throw new Error("Failed to mark footer component.");
    }
    // SAFETY: The two non-configurable symbol properties were just installed and
    // verified through this module's marker parser; callers cannot construct the marker.
    return component as T & MarkedFooterComponent;
}

export function getFooterComponentKind(value: unknown): FooterComponentKind | undefined {
    if (!isObject(value)) return undefined;

    if (Reflect.get(value, FOOTER_COMPONENT_MARKER) !== true) return undefined;

    const kind: unknown = Reflect.get(value, FOOTER_COMPONENT_KIND) as unknown;
    if (kind === "live" || kind === "bridge") return kind;
    return undefined;
}
