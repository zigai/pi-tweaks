import { describe, expect, test } from "vitest";

import {
    installKeyedLinkedMethodPatch,
    installLinkedMethodPatch,
    installLinkedRenderPatch,
} from "@zigai/pi-extension-internals";

class Renderer {
    render(width: number): string[] {
        return [`base:${width}`];
    }
}

const LINKED_PATCH_PROTOCOL = Symbol.for("zigai.pi-tweaks.render-patch-protocol-version");
const LINKED_PATCH_PREDECESSOR = Symbol.for("zigai.pi-tweaks.render-patch-predecessor");
const LINKED_PATCH_PREDECESSOR_DESCRIPTOR = Symbol.for(
    "zigai.pi-tweaks.render-patch-predecessor-descriptor",
);
const KEYED_PATCH_PROTOCOL = Symbol.for("zigai.pi-tweaks.keyed-method-patch-protocol-version");

function patchKey(name: string): symbol {
    return Symbol.for(`zigai.pi-extension-internals.test.${name}`);
}

function appendRender(label: string) {
    return (predecessor: Renderer["render"]): Renderer["render"] =>
        function (this: Renderer, width: number): string[] {
            return [...predecessor.call(this, width), label];
        };
}

describe("linked method patches", () => {
    test("removes the top patch and restores its current predecessor", () => {
        const first = installLinkedRenderPatch(Renderer.prototype, appendRender("first"));
        const second = installLinkedRenderPatch(Renderer.prototype, appendRender("second"));
        const renderer = new Renderer();

        expect(renderer.render(8)).toEqual(["base:8", "first", "second"]);
        expect(second.predecessor).toBe(first.patched);

        second.dispose();
        second.dispose();
        expect(renderer.render(8)).toEqual(["base:8", "first"]);

        first.dispose();
        expect(renderer.render(8)).toEqual(["base:8"]);
    });

    test("rewires a dynamically linked successor when a middle patch is removed", () => {
        const first = installLinkedRenderPatch(Renderer.prototype, appendRender("first"));
        const second = installLinkedRenderPatch(Renderer.prototype, appendRender("second"));
        const third = installLinkedRenderPatch(Renderer.prototype, appendRender("third"));
        const renderer = new Renderer();

        second.dispose();
        expect(renderer.render(5)).toEqual(["base:5", "first", "third"]);

        third.dispose();
        first.dispose();
        expect(renderer.render(5)).toEqual(["base:5"]);
    });

    test("restores inheritance without leaving an own method", () => {
        class BaseRenderer {
            render(width: number): string[] {
                return [`inherited:${width}`];
            }
        }
        class ChildRenderer extends BaseRenderer {}

        const lower = installLinkedRenderPatch(
            ChildRenderer.prototype,
            (predecessor) =>
                function (this: ChildRenderer, width: number): string[] {
                    return [...predecessor.call(this, width), "lower"];
                },
        );
        const upper = installLinkedRenderPatch(
            ChildRenderer.prototype,
            (predecessor) =>
                function (this: ChildRenderer, width: number): string[] {
                    return [...predecessor.call(this, width), "upper"];
                },
        );

        lower.dispose();
        expect(new ChildRenderer().render(2)).toEqual(["inherited:2", "upper"]);
        upper.dispose();

        expect(Object.hasOwn(ChildRenderer.prototype, "render")).toBe(false);
        expect(new ChildRenderer().render(2)).toEqual(["inherited:2"]);
    });

    test("supports linked methods with arbitrary keys and signatures", () => {
        class Calculator {
            calculate(value: number, increment: number): number {
                return value + increment;
            }
        }

        const patch = installLinkedMethodPatch(
            Calculator.prototype,
            "calculate",
            (predecessor) =>
                function (this: Calculator, value: number, increment: number): number {
                    return predecessor.call(this, value, increment) * 2;
                },
        );

        expect(new Calculator().calculate(3, 4)).toBe(14);
        patch.dispose();
        expect(new Calculator().calculate(3, 4)).toBe(7);
    });

    test("updates a globally keyed patch without adding another layer", () => {
        const marker = patchKey("keyed-render");
        const first = installKeyedLinkedMethodPatch(
            Renderer.prototype,
            "render",
            marker,
            { label: "first" },
            (predecessor, getPolicy) =>
                function (this: Renderer, width: number): string[] {
                    return [...predecessor.call(this, width), getPolicy().label];
                },
        );
        const second = installKeyedLinkedMethodPatch(
            Renderer.prototype,
            "render",
            marker,
            { label: "updated" },
            () => {
                throw new Error("An existing keyed patch must not create another transform");
            },
        );

        expect(second).toBe(first);
        expect(new Renderer().render(4)).toEqual(["base:4", "updated"]);
        second.dispose();
        expect(new Renderer().render(4)).toEqual(["base:4"]);
    });

    test("requires globally registered keyed patch markers", () => {
        expect(() =>
            installKeyedLinkedMethodPatch(
                Renderer.prototype,
                "render",
                Symbol("local"),
                undefined,
                (predecessor) => predecessor,
            ),
        ).toThrow("Symbol.for");
    });

    test("rejects non-extensible transformed methods without patching the target", () => {
        const frozenRender = Object.preventExtensions(function (
            this: Renderer,
            width: number,
        ): string[] {
            return [`frozen:${width}`];
        });

        expect(() => installLinkedRenderPatch(Renderer.prototype, () => frozenRender)).toThrow(
            "non-extensible",
        );
        expect(new Renderer().render(6)).toEqual(["base:6"]);
    });

    test("rolls back metadata when the target rejects a transformed method", () => {
        const original: Renderer["render"] = function (width: number): string[] {
            return [`base:${width}`];
        };
        const target = { render: original } satisfies { render: Renderer["render"] };
        Object.defineProperty(target, "render", {
            configurable: true,
            get: () => original,
            set: () => {},
        });
        let transformed: Renderer["render"] | undefined;

        expect(() =>
            installLinkedRenderPatch(target, (predecessor) => {
                transformed = function (this: Renderer, width: number): string[] {
                    return [...predecessor.call(this, width), "unreachable"];
                };
                return transformed;
            }),
        ).toThrow("Unable to patch method render");
        if (transformed === undefined) throw new Error("Expected the transform to run");
        expect(Object.hasOwn(transformed, LINKED_PATCH_PREDECESSOR)).toBe(false);
        expect(Object.hasOwn(transformed, LINKED_PATCH_PREDECESSOR_DESCRIPTOR)).toBe(false);
        expect(Object.hasOwn(transformed, LINKED_PATCH_PROTOCOL)).toBe(false);
        expect(target.render).toBe(original);
    });

    test("rolls back metadata when the target setter throws", () => {
        const original: Renderer["render"] = function (width: number): string[] {
            return [`base:${width}`];
        };
        const target = { render: original } satisfies { render: Renderer["render"] };
        Object.defineProperty(target, "render", {
            configurable: true,
            get: () => original,
            set: () => {
                throw new Error("setter failed");
            },
        });
        let transformed: Renderer["render"] | undefined;

        expect(() =>
            installLinkedRenderPatch(target, (predecessor) => {
                transformed = function (this: Renderer, width: number): string[] {
                    return [...predecessor.call(this, width), "unreachable"];
                };
                return transformed;
            }),
        ).toThrow("setter failed");
        if (transformed === undefined) throw new Error("Expected the transform to run");
        expect(Object.hasOwn(transformed, LINKED_PATCH_PREDECESSOR)).toBe(false);
        expect(Object.hasOwn(transformed, LINKED_PATCH_PREDECESSOR_DESCRIPTOR)).toBe(false);
        expect(Object.hasOwn(transformed, LINKED_PATCH_PROTOCOL)).toBe(false);
        expect(target.render).toBe(original);
    });
    test("rejects incompatible keyed patch records before changing the method", () => {
        const marker = patchKey("incompatible-keyed");
        Reflect.defineProperty(Renderer.prototype, marker, {
            configurable: true,
            value: {
                [KEYED_PATCH_PROTOCOL]: 2,
                methodKey: "render",
                handle: {},
            },
        });

        try {
            expect(() =>
                installKeyedLinkedMethodPatch(
                    Renderer.prototype,
                    "render",
                    marker,
                    undefined,
                    (predecessor) => predecessor,
                ),
            ).toThrow("Unsupported keyed method patch protocol version 2");
            expect(new Renderer().render(6)).toEqual(["base:6"]);
        } finally {
            Reflect.deleteProperty(Renderer.prototype, marker);
        }
    });

    test("accepts legacy unversioned patch metadata and rejects incompatible versions", () => {
        const first = installLinkedRenderPatch(Renderer.prototype, appendRender("first"));
        Reflect.deleteProperty(first.patched, LINKED_PATCH_PROTOCOL);
        const second = installLinkedRenderPatch(Renderer.prototype, appendRender("second"));

        expect(new Renderer().render(3)).toEqual(["base:3", "first", "second"]);
        Reflect.defineProperty(first.patched, LINKED_PATCH_PROTOCOL, {
            configurable: true,
            value: 2,
        });
        expect(() => new Renderer().render(3)).toThrow(
            "Unsupported linked method patch protocol version 2",
        );
        expect(() => first.dispose()).toThrow("Unsupported linked method patch protocol version 2");

        Reflect.deleteProperty(first.patched, LINKED_PATCH_PROTOCOL);
        first.dispose();
        second.dispose();
        expect(new Renderer().render(3)).toEqual(["base:3"]);
    });
});
