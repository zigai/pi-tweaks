import type * as EditorProtocolModule from "../src/editor-enhancer-registry.ts";
import type * as PatchProtocolModule from "../src/linked-method-patch.ts";

import { expect, test } from "vitest";

type EditorProtocol = typeof EditorProtocolModule;
type PatchProtocol = typeof PatchProtocolModule;

async function loadProtocolCopy<T>(relativePath: string, copy: string): Promise<T> {
    const moduleUrl = new URL(`${relativePath}?copy=${copy}`, import.meta.url).href;
    // Dynamic import is the behavior under test: query-distinct URLs force separate module copies.
    const loaded: unknown = await import(moduleUrl);
    if (typeof loaded !== "object" || loaded === null) {
        throw new TypeError(`Unable to load protocol copy ${copy}`);
    }
    // SAFETY: Each caller supplies a checked source-module URL and immediately exercises the
    // expected public functions through their runtime contracts.
    return loaded as T;
}

class EditorUi {
    private factory: ((label: string) => string[]) | undefined = () => ["base"];

    getEditorComponent(): ((label: string) => string[]) | undefined {
        return this.factory;
    }

    setEditorComponent(factory: ((label: string) => string[]) | undefined): void {
        this.factory = factory;
    }

    render(): string[] {
        if (this.factory === undefined) throw new Error("Expected an editor factory");
        return this.factory("prompt");
    }
}

class Renderer {
    render(width: number): string[] {
        return [`base:${width}`];
    }
}

test("independently loaded editor protocol copies share registrations and disposal", async () => {
    const first = await loadProtocolCopy<EditorProtocol>("../src/editor-enhancer-registry.ts", "a");
    const second = await loadProtocolCopy<EditorProtocol>(
        "../src/editor-enhancer-registry.ts",
        "b",
    );
    expect(first.registerEditorEnhancer).not.toBe(second.registerEditorEnhancer);

    const ui = new EditorUi();
    const context = { hasUI: true, ui };
    const firstHandle = first.registerEditorEnhancer(
        context,
        Symbol.for("zigai.pi-extension-internals.test.copy-first"),
        () => ["fallback-a"],
        (editor) => [...editor, "first"],
    );
    const secondHandle = second.registerEditorEnhancer(
        context,
        Symbol.for("zigai.pi-extension-internals.test.copy-second"),
        () => ["fallback-b"],
        (editor) => [...editor, "second"],
    );

    expect(ui.render()).toEqual(["base", "first", "second"]);
    firstHandle.dispose();
    expect(ui.render()).toEqual(["base", "second"]);
    secondHandle.dispose();
    expect(ui.render()).toEqual(["base"]);
});

test("independently loaded linked patch copies compose and rewire each other", async () => {
    const first = await loadProtocolCopy<PatchProtocol>("../src/linked-method-patch.ts", "a");
    const second = await loadProtocolCopy<PatchProtocol>("../src/linked-method-patch.ts", "b");
    expect(first.installLinkedRenderPatch).not.toBe(second.installLinkedRenderPatch);

    const lower = first.installLinkedRenderPatch(
        Renderer.prototype,
        (predecessor) =>
            function (this: Renderer, width: number): string[] {
                return [...predecessor.call(this, width), "lower"];
            },
    );
    const upper = second.installLinkedRenderPatch(
        Renderer.prototype,
        (predecessor) =>
            function (this: Renderer, width: number): string[] {
                return [...predecessor.call(this, width), "upper"];
            },
    );

    expect(new Renderer().render(7)).toEqual(["base:7", "lower", "upper"]);
    lower.dispose();
    expect(new Renderer().render(7)).toEqual(["base:7", "upper"]);
    upper.dispose();
    expect(new Renderer().render(7)).toEqual(["base:7"]);
});

test("independently loaded keyed patch copies update one shared registration", async () => {
    const first = await loadProtocolCopy<PatchProtocol>("../src/linked-method-patch.ts", "keyed-a");
    const second = await loadProtocolCopy<PatchProtocol>(
        "../src/linked-method-patch.ts",
        "keyed-b",
    );
    const marker = Symbol.for("zigai.pi-extension-internals.test.copy-keyed");
    const firstHandle = first.installKeyedLinkedMethodPatch(
        Renderer.prototype,
        "render",
        marker,
        "first",
        (predecessor, getLabel) =>
            function (this: Renderer, width: number): string[] {
                return [...predecessor.call(this, width), getLabel()];
            },
    );
    const secondHandle = second.installKeyedLinkedMethodPatch(
        Renderer.prototype,
        "render",
        marker,
        "updated",
        () => {
            throw new Error("A compatible copy must reuse the keyed patch");
        },
    );

    expect(secondHandle).toBe(firstHandle);
    expect(new Renderer().render(2)).toEqual(["base:2", "updated"]);
    secondHandle.dispose();
    expect(new Renderer().render(2)).toEqual(["base:2"]);
});
