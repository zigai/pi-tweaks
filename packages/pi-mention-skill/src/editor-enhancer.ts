import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { EditorFactory, EditorLike } from "./types.ts";

const EDITOR_ENHANCER_REGISTRY = Symbol.for("zigai.pi-tweaks.editor-enhancer-registry");
const EDITOR_ENHANCER_FACTORY = Symbol.for("zigai.pi-tweaks.editor-enhancer-factory");

type EditorEnhancer = (editor: EditorLike) => EditorLike;

type EditorEnhancerRegistry = {
    baseFactory: EditorFactory | undefined;
    enhancers: Map<symbol, EditorEnhancer>;
};

type EnhancerEditorFactory = EditorFactory & {
    [EDITOR_ENHANCER_FACTORY]?: true;
};

type EditorEnhancerUi = ExtensionContext["ui"] & {
    [EDITOR_ENHANCER_REGISTRY]?: EditorEnhancerRegistry | undefined;
};

export function applyEditorEnhancer(
    ctx: ExtensionContext,
    enhancerKey: symbol,
    enhancer: EditorEnhancer,
): void {
    if (!ctx.hasUI) return;

    const ui = ctx.ui as EditorEnhancerUi;
    const existing = ctx.ui.getEditorComponent() as EnhancerEditorFactory | undefined;
    let registry = ui[EDITOR_ENHANCER_REGISTRY];
    if (registry === undefined || existing?.[EDITOR_ENHANCER_FACTORY] !== true) {
        registry = {
            baseFactory: existing,
            enhancers: new Map(registry?.enhancers),
        };
        ui[EDITOR_ENHANCER_REGISTRY] = registry;
    }

    registry.enhancers.set(enhancerKey, enhancer);

    const factory = ((tui, theme, keybindings) => {
        const editor = (registry.baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as unknown as EditorLike;
        let enhanced = editor;
        for (const editorEnhancer of registry.enhancers.values()) {
            enhanced = editorEnhancer(enhanced);
        }
        return enhanced;
    }) as EnhancerEditorFactory;
    factory[EDITOR_ENHANCER_FACTORY] = true;

    ctx.ui.setEditorComponent(factory);
}
