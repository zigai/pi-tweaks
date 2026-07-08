import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const UI_TWEAKS_EDITOR_FACTORY_LAYERS = Symbol.for("zigai.pi-ui-tweaks.editor-factory-layers");

export type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export type UiTweaksEditorFactoryLayer = "bashExecSpacing" | "pasteCollapse";

type LayeredEditorFactory = EditorFactory & {
    [UI_TWEAKS_EDITOR_FACTORY_LAYERS]?: ReadonlySet<UiTweaksEditorFactoryLayer>;
};

function getEditorFactoryLayers(
    factory: EditorFactory | undefined,
): ReadonlySet<UiTweaksEditorFactoryLayer> | undefined {
    if (factory === undefined) {
        return undefined;
    }

    // SAFETY: The symbol property is extension-owned metadata on editor factory functions.
    const layeredFactory = factory as LayeredEditorFactory;
    return layeredFactory[UI_TWEAKS_EDITOR_FACTORY_LAYERS];
}

/** Returns whether an editor factory already includes a UI-tweaks wrapper layer. */
export function hasEditorFactoryLayer(
    factory: EditorFactory | undefined,
    layer: UiTweaksEditorFactoryLayer,
): boolean {
    return getEditorFactoryLayers(factory)?.has(layer) === true;
}

/** Copies existing UI-tweaks layer metadata onto a newly wrapped editor factory. */
export function markEditorFactoryLayer(
    factory: EditorFactory,
    existingFactory: EditorFactory | undefined,
    layer: UiTweaksEditorFactoryLayer,
): void {
    const nextLayers = new Set<UiTweaksEditorFactoryLayer>();
    const existingLayers = getEditorFactoryLayers(existingFactory);
    if (existingLayers !== undefined) {
        for (const existingLayer of existingLayers) {
            nextLayers.add(existingLayer);
        }
    }
    nextLayers.add(layer);

    // SAFETY: The symbol property is extension-owned metadata on editor factory functions.
    const layeredFactory = factory as LayeredEditorFactory;
    layeredFactory[UI_TWEAKS_EDITOR_FACTORY_LAYERS] = nextLayers;
}
