import * as internals from "@zigai/pi-extension-internals";
import { expect, test } from "vitest";

test("package root exposes only supported runtime capabilities", () => {
    expect(Object.keys(internals).sort()).toEqual([
        "installKeyedLinkedMethodPatch",
        "installLinkedMethodPatch",
        "installLinkedRenderPatch",
        "loadPiInternalModule",
        "loadPiRuntimeModule",
        "registerEditorEnhancer",
        "warnPiInternalPatchUnavailable",
    ]);
    expect("resolvePiInternalModuleUrl" in internals).toBe(false);
});
