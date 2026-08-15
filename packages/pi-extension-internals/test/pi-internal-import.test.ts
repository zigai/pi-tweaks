import { expect, test } from "vitest";

import {
    loadPiInternalModule,
    warnPiInternalPatchUnavailable,
} from "@zigai/pi-extension-internals";

async function captureWarnings(run: () => Promise<void> | void): Promise<string[]> {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...values: unknown[]): void => {
        warnings.push(values.map((value) => String(value)).join(" "));
    };
    try {
        await run();
    } finally {
        console.warn = originalWarn;
    }
    return warnings;
}

test("formats Pi internal patch warnings with optional Error details", async () => {
    const warnings = await captureWarnings(() => {
        warnPiInternalPatchUnavailable("pi-example", "message patch");
        warnPiInternalPatchUnavailable("pi-example", "selector patch", new Error("export missing"));
        warnPiInternalPatchUnavailable("pi-example", "theme patch", "not an Error");
        warnPiInternalPatchUnavailable("pi-example", "empty error patch", new Error(""));
    });

    expect(warnings).toEqual([
        "[pi-example] message patch unavailable; Pi internals may have changed",
        "[pi-example] selector patch unavailable; Pi internals may have changed: export missing",
        "[pi-example] theme patch unavailable; Pi internals may have changed",
        "[pi-example] empty error patch unavailable; Pi internals may have changed",
    ]);
});

test("loads and parses a real Pi internal module through the guarded boundary", async () => {
    const warnings = await captureWarnings(async () => {
        const loaded = await loadPiInternalModule("modes/interactive/theme/theme.js", {
            scope: "pi-example",
            feature: "theme",
            parse(module) {
                if ((typeof module !== "object" || module === null) && typeof module !== "function")
                    return undefined;
                if (Reflect.get(module, "theme") === undefined) return undefined;
                return "loaded";
            },
        });
        expect(loaded).toBe("loaded");
    });

    expect(warnings).toEqual([]);
});

test("reports parser rejection, parser failures, and missing Pi modules", async () => {
    const warnings = await captureWarnings(async () => {
        expect(
            await loadPiInternalModule("modes/interactive/theme/theme.js", {
                scope: "pi-example",
                feature: "rejected theme",
                parse: () => undefined,
            }),
        ).toBeUndefined();
        expect(
            await loadPiInternalModule("modes/interactive/theme/theme.js", {
                scope: "pi-example",
                feature: "broken parser",
                parse() {
                    throw new Error("invalid theme shape");
                },
            }),
        ).toBeUndefined();
        expect(
            await loadPiInternalModule("missing/internal-module.js", {
                scope: "pi-example",
                feature: "missing module",
                parse: () => "unreachable",
            }),
        ).toBeUndefined();
    });

    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toBe(
        "[pi-example] rejected theme unavailable; Pi internals may have changed",
    );
    expect(warnings[1]).toBe(
        "[pi-example] broken parser unavailable; Pi internals may have changed: invalid theme shape",
    );
    expect(warnings[2]).toContain(
        "[pi-example] missing module unavailable; Pi internals may have changed:",
    );
});

test("rejects internal module paths outside the coding-agent package", async () => {
    let parserCalls = 0;
    const warnings = await captureWarnings(async () => {
        const parse = (): string => {
            parserCalls += 1;
            return "unreachable";
        };
        expect(
            await loadPiInternalModule("../package.json", {
                scope: "pi-example",
                feature: "traversal module",
                parse,
            }),
        ).toBeUndefined();
        expect(
            await loadPiInternalModule("/tmp/outside.js", {
                scope: "pi-example",
                feature: "absolute module",
                parse,
            }),
        ).toBeUndefined();
    });

    expect(parserCalls).toBe(0);
    expect(warnings).toEqual([
        "[pi-example] traversal module unavailable; Pi internals may have changed: Pi internal module path escapes the coding-agent package",
        "[pi-example] absolute module unavailable; Pi internals may have changed: Pi internal module path must be relative to the coding-agent package",
    ]);
});
