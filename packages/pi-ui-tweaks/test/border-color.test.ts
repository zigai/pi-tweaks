import assert from "node:assert/strict";
import { loadPiInternalModule } from "@zigai/pi-extension-internals";
import { test } from "vitest";

import { installNeutralBorderColorPatch } from "../src/border-color.ts";

function readThemePrototype(module: unknown): object & { fg(color: string, text: string): string } {
    if ((typeof module !== "object" && typeof module !== "function") || module === null) {
        assert.fail("missing Pi theme module");
    }
    const theme: unknown = Reflect.get(module, "Theme");
    const prototype: unknown = Reflect.get(theme ?? {}, "prototype");
    if (
        typeof prototype !== "object" ||
        prototype === null ||
        typeof Reflect.get(prototype, "fg") !== "function"
    ) {
        assert.fail("invalid Pi Theme prototype");
    }
    // SAFETY: The runtime checks above prove the private Theme.fg seam used by this test.
    return prototype as object & { fg(color: string, text: string): string };
}

test("neutral border patch is removable and reuses its handle", async () => {
    const prototype = await loadPiInternalModule("modes/interactive/theme/theme.js", {
        scope: "pi-ui-tweaks-test",
        feature: "Theme prototype",
        parse: readThemePrototype,
    });
    if (prototype === undefined) assert.fail("missing Pi Theme prototype");
    const original = Reflect.get(prototype, "fg");
    const handle = await installNeutralBorderColorPatch({ neutralBorderColor: true });
    const patched = Reflect.get(prototype, "fg");
    assert.notEqual(patched, original);

    const same = await installNeutralBorderColorPatch({ neutralBorderColor: false });
    assert.equal(same, handle);
    assert.equal(Reflect.get(prototype, "fg"), patched);

    handle.dispose();
    assert.equal(Reflect.get(prototype, "fg"), original);
});
