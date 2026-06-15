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
    return component as T & MarkedFooterComponent;
}

export function getFooterComponentKind(value: unknown): FooterComponentKind | undefined {
    if (!isObject(value)) return undefined;

    const candidate = value as Partial<MarkedFooterComponent>;
    if (candidate[FOOTER_COMPONENT_MARKER] !== true) return undefined;

    const kind = candidate[FOOTER_COMPONENT_KIND];
    if (kind === "live" || kind === "bridge") return kind;
    return undefined;
}
