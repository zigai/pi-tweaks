import { describe, expect, test } from "vitest";

import { registerEditorEnhancer, type EditorFactory } from "@zigai/pi-extension-internals";

type FactoryArgs = [label: string, count: number];
type Editor = string[];

function enhancerKey(name: string): symbol {
    return Symbol.for(`zigai.pi-extension-internals.test.${name}`);
}

const EDITOR_ENHANCER_REGISTRY = Symbol.for("zigai.pi-tweaks.editor-enhancer-registry");
const EDITOR_ENHANCER_PROTOCOL = Symbol.for("zigai.pi-tweaks.editor-enhancer-protocol-version");

class EditorUi {
    private factory: EditorFactory<FactoryArgs, Editor> | undefined;

    constructor(factory?: EditorFactory<FactoryArgs, Editor>) {
        this.factory = factory;
    }

    getEditorComponent(): EditorFactory<FactoryArgs, Editor> | undefined {
        return this.factory;
    }

    setEditorComponent(factory: EditorFactory<FactoryArgs, Editor> | undefined): void {
        this.factory = factory;
    }
}

class FailingEditorUi extends EditorUi {
    private failSet = false;

    failNextSet(): void {
        this.failSet = true;
    }

    override setEditorComponent(factory: EditorFactory<FactoryArgs, Editor> | undefined): void {
        if (this.failSet) {
            this.failSet = false;
            throw new Error("set editor failed");
        }
        super.setEditorComponent(factory);
    }
}

function renderEditor(ui: EditorUi): Editor {
    const factory = ui.getEditorComponent();
    if (factory === undefined) {
        throw new Error("Expected an installed editor factory");
    }
    return factory("prompt", 3);
}

describe("registerEditorEnhancer", () => {
    test("replaces keyed enhancers without reordering and forwards factory arguments", () => {
        const ui = new EditorUi();
        const ctx = { hasUI: true, ui };
        const createDefault: EditorFactory<FactoryArgs, Editor> = (label, count) => [
            `default:${label}:${count}`,
        ];
        const first = registerEditorEnhancer(
            ctx,
            enhancerKey("replacement-first"),
            createDefault,
            (editor, label, count) => [...editor, `first:${label}:${count}`],
        );
        registerEditorEnhancer(ctx, enhancerKey("replacement-second"), createDefault, (editor) => [
            ...editor,
            "second",
        ]);
        const replacement = registerEditorEnhancer(
            ctx,
            enhancerKey("replacement-first"),
            createDefault,
            (editor) => [...editor, "replacement"],
        );
        first.dispose();
        replacement.update((editor) => [...editor, "updated"]);

        expect(renderEditor(ui)).toEqual(["default:prompt:3", "updated", "second"]);
    });

    test("rebases over arbitrary factories and restores the base after idempotent disposal", () => {
        const originalBase: EditorFactory<FactoryArgs, Editor> = () => ["original"];
        const rebasedFactory: EditorFactory<FactoryArgs, Editor> = () => ["rebased"];
        const createDefault: EditorFactory<FactoryArgs, Editor> = () => ["default"];
        const ui = new EditorUi(originalBase);
        const ctx = { hasUI: true, ui };
        const first = registerEditorEnhancer(
            ctx,
            enhancerKey("rebase-first"),
            createDefault,
            (editor) => [...editor, "first"],
        );

        ui.setEditorComponent(rebasedFactory);
        const second = registerEditorEnhancer(
            ctx,
            enhancerKey("rebase-second"),
            createDefault,
            (editor) => [...editor, "second"],
        );
        expect(renderEditor(ui)).toEqual(["rebased", "first", "second"]);

        first.dispose();
        expect(renderEditor(ui)).toEqual(["rebased", "second"]);
        second.dispose();
        second.dispose();

        expect(ui.getEditorComponent()).toBe(rebasedFactory);
    });

    test("returns an inert handle when no UI is available", () => {
        const ui = new EditorUi();
        const handle = registerEditorEnhancer(
            { hasUI: false, ui },
            enhancerKey("headless"),
            () => ["default"],
            (editor) => [...editor, "unused"],
        );

        handle.update((editor) => [...editor, "still-unused"]);
        handle.dispose();
        expect(ui.getEditorComponent()).toBeUndefined();
    });

    test("keeps the first fallback factory when later extensions register", () => {
        const ui = new EditorUi();
        const ctx = { hasUI: true, ui };
        const first = registerEditorEnhancer(
            ctx,
            enhancerKey("fallback-first"),
            () => ["first-default"],
            (editor) => [...editor, "first"],
        );
        const second = registerEditorEnhancer(
            ctx,
            enhancerKey("fallback-second"),
            () => ["second-default"],
            (editor) => [...editor, "second"],
        );

        expect(renderEditor(ui)).toEqual(["first-default", "first", "second"]);
        second.dispose();
        first.dispose();
    });

    test("requires reload-stable globally registered keys", () => {
        const ui = new EditorUi();
        expect(() =>
            registerEditorEnhancer(
                { hasUI: true, ui },
                Symbol("local"),
                () => ["default"],
                (editor) => editor,
            ),
        ).toThrow("Symbol.for");
    });

    test("adopts a structurally valid legacy registry as protocol v1", () => {
        const ui = new EditorUi();
        const ctx = { hasUI: true, ui };
        const first = registerEditorEnhancer(
            ctx,
            enhancerKey("legacy-first"),
            () => ["default"],
            (editor) => [...editor, "first"],
        );
        const registry: unknown = Reflect.get(ui, EDITOR_ENHANCER_REGISTRY);
        if (typeof registry !== "object" || registry === null) {
            throw new TypeError("Expected an installed editor enhancer registry");
        }
        Reflect.deleteProperty(registry, EDITOR_ENHANCER_PROTOCOL);

        const second = registerEditorEnhancer(
            ctx,
            enhancerKey("legacy-second"),
            () => ["ignored"],
            (editor) => [...editor, "second"],
        );

        expect(Reflect.get(registry, EDITOR_ENHANCER_PROTOCOL)).toBe(1);
        expect(renderEditor(ui)).toEqual(["default", "first", "second"]);
        second.dispose();
        first.dispose();
    });

    test("rejects an incompatible shared registry version", () => {
        const ui = new EditorUi();
        Reflect.set(ui, EDITOR_ENHANCER_REGISTRY, {
            [EDITOR_ENHANCER_PROTOCOL]: 2,
        });

        expect(() =>
            registerEditorEnhancer(
                { hasUI: true, ui },
                enhancerKey("incompatible"),
                () => ["default"],
                (editor) => editor,
            ),
        ).toThrow("Unsupported editor enhancer protocol version 2");
    });

    test("rejects malformed enhancer entries in a shared registry", () => {
        const ui = new EditorUi();
        const ctx = { hasUI: true, ui };
        const first = registerEditorEnhancer(
            ctx,
            enhancerKey("malformed-first"),
            () => ["default"],
            (editor) => [...editor, "first"],
        );
        const registry: unknown = Reflect.get(ui, EDITOR_ENHANCER_REGISTRY);
        if (typeof registry !== "object" || registry === null) {
            throw new TypeError("Expected an installed editor enhancer registry");
        }
        const enhancers: unknown = Reflect.get(registry, "enhancers");
        if (!(enhancers instanceof Map)) {
            throw new TypeError("Expected an enhancer registry map");
        }
        const enhancerMap: Map<unknown, unknown> = enhancers;
        const malformedKey = enhancerKey("malformed-entry");
        enhancerMap.set(malformedKey, { enhancer: "not callable" });

        try {
            expect(() =>
                registerEditorEnhancer(
                    ctx,
                    enhancerKey("malformed-second"),
                    () => ["ignored"],
                    (editor) => editor,
                ),
            ).toThrow("Incompatible editor enhancer registry");
        } finally {
            enhancerMap.delete(malformedKey);
            first.dispose();
        }
    });

    test("does not partially install a registry on a non-extensible UI", () => {
        const ui = Object.preventExtensions(new EditorUi());

        expect(() =>
            registerEditorEnhancer(
                { hasUI: true, ui },
                enhancerKey("non-extensible-ui"),
                () => ["default"],
                (editor) => editor,
            ),
        ).toThrow("Unable to store the editor enhancer registry");
        expect(ui.getEditorComponent()).toBeUndefined();
    });

    test("rolls back a new registry when editor activation fails", () => {
        const ui = new FailingEditorUi();
        ui.failNextSet();

        expect(() =>
            registerEditorEnhancer(
                { hasUI: true, ui },
                enhancerKey("failed-activation"),
                () => ["default"],
                (editor) => [...editor, "unreachable"],
            ),
        ).toThrow("set editor failed");
        expect(Object.hasOwn(ui, EDITOR_ENHANCER_REGISTRY)).toBe(false);
        expect(ui.getEditorComponent()).toBeUndefined();

        const recovered = registerEditorEnhancer(
            { hasUI: true, ui },
            enhancerKey("recovered-activation"),
            () => ["default"],
            (editor) => [...editor, "recovered"],
        );
        expect(renderEditor(ui)).toEqual(["default", "recovered"]);
        recovered.dispose();
    });

    test("allows disposal to be retried after restoring the editor fails", () => {
        const ui = new FailingEditorUi();
        const handle = registerEditorEnhancer(
            { hasUI: true, ui },
            enhancerKey("retry-disposal"),
            () => ["default"],
            (editor) => [...editor, "enhanced"],
        );
        ui.failNextSet();

        expect(() => handle.dispose()).toThrow("set editor failed");
        expect(Object.hasOwn(ui, EDITOR_ENHANCER_REGISTRY)).toBe(true);
        expect(renderEditor(ui)).toEqual(["default", "enhanced"]);

        handle.dispose();
        expect(Object.hasOwn(ui, EDITOR_ENHANCER_REGISTRY)).toBe(false);
        expect(ui.getEditorComponent()).toBeUndefined();
    });
});
