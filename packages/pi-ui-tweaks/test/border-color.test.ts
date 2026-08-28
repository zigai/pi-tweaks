import assert from "node:assert/strict";
import { loadPiInternalModule } from "@zigai/pi-extension-internals";
import { test } from "vitest";

import { installNeutralBorderColorPatch } from "../src/border-color.ts";

type ThemeFg = (color: string, text: string) => string;
type ThemePrototype = {
    readonly fg: ThemeFg;
};

type ThemeModule = {
    readonly Theme: {
        readonly prototype: ThemePrototype;
    };
};

type ModuleView = { readonly Theme?: unknown };
type ThemeView = { readonly prototype?: unknown };
type PrototypeView = { readonly fg?: unknown };

function isThemePrototype(value: unknown): value is ThemePrototype {
    if (typeof value !== "object" || value === null) return false;
    // SAFETY: PrototypeView exposes only the fg field validated by this predicate.
    const view = value as PrototypeView;
    return typeof view.fg === "function";
}

function isThemeModule(value: unknown): value is ThemeModule {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
    // SAFETY: ModuleView exposes only the Theme export validated below.
    const theme = (value as ModuleView).Theme;
    if ((typeof theme !== "object" && typeof theme !== "function") || theme === null) return false;
    // SAFETY: ThemeView exposes only the prototype field validated below.
    return isThemePrototype((theme as ThemeView).prototype);
}

test("neutral border patch is removable and reuses its handle", async () => {
    const prototype = await loadPiInternalModule("modes/interactive/theme/theme.js", {
        scope: "pi-ui-tweaks-test",
        feature: "Theme prototype",
        parse(module) {
            if (!isThemeModule(module)) assert.fail("invalid Pi Theme module");
            return module.Theme.prototype;
        },
    });
    if (prototype === undefined) assert.fail("missing Pi Theme prototype");
    const original = prototype.fg;
    const handle = await installNeutralBorderColorPatch({ neutralBorderColor: true });
    const patched = prototype.fg;
    assert.notEqual(patched, original);

    const same = await installNeutralBorderColorPatch({ neutralBorderColor: false });
    assert.equal(same, handle);
    assert.equal(prototype.fg, patched);

    handle.dispose();
    assert.equal(prototype.fg, original);
});
