import { CustomEditor } from "@earendil-works/pi-coding-agent";

import type { EditorEnhancerContext, EditorFactory, EditorLike } from "./types.ts";

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

type EditorEnhancerUi = EditorEnhancerContext["ui"] & {
    [EDITOR_ENHANCER_REGISTRY]?: EditorEnhancerRegistry | undefined;
};

function isEnhancerEditorFactory(value: EditorFactory | undefined): value is EnhancerEditorFactory {
    return value !== undefined && Reflect.get(value, EDITOR_ENHANCER_FACTORY) === true;
}

export function applyEditorEnhancer(
    ctx: EditorEnhancerContext,
    enhancerKey: symbol,
    enhancer: EditorEnhancer,
): void {
    if (!ctx.hasUI) return;

    const ui: EditorEnhancerUi = ctx.ui;
    const existing = ctx.ui.getEditorComponent();
    let registry = ui[EDITOR_ENHANCER_REGISTRY];
    if (registry === undefined || !isEnhancerEditorFactory(existing)) {
        registry = {
            baseFactory: existing,
            enhancers: new Map(registry?.enhancers),
        };
        ui[EDITOR_ENHANCER_REGISTRY] = registry;
    }

    registry.enhancers.set(enhancerKey, enhancer);

    const factory: EnhancerEditorFactory = (tui, theme, keybindings) => {
        const editor: EditorLike =
            registry.baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings);
        let enhanced = editor;
        for (const editorEnhancer of registry.enhancers.values()) {
            enhanced = editorEnhancer(enhanced);
        }
        return enhanced;
    };
    factory[EDITOR_ENHANCER_FACTORY] = true;

    ctx.ui.setEditorComponent(factory);
}
