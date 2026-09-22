import type { SessionTreeNode } from "@earendil-works/pi-coding-agent";
import { loadPiRuntimeModule } from "./pi-runtime-import.ts";

export type TreeSelectorModule = {
    TreeSelectorComponent: new (
        entries: SessionTreeNode[],
        selectedId: string | null,
        height: number,
        onSelect: () => undefined,
        onCancel: () => undefined,
        onLabel: () => undefined,
        initialSelectedId: undefined,
        initialFilterMode: undefined,
    ) => object;
};

function isObjectIdentity(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

export type ThemeModule = {
    initTheme: (name: string | undefined, enableWatcher: boolean) => void;
    theme: object;
};

export const treeSelectorRuntime = {
    parse: (module: unknown): TreeSelectorModule | undefined => {
        if (
            !isObjectIdentity(module) ||
            !("TreeSelectorComponent" in module) ||
            typeof module.TreeSelectorComponent !== "function"
        ) {
            return undefined;
        }

        const component = module.TreeSelectorComponent;
        if (!("prototype" in component)) return undefined;

        const prototype: unknown = component.prototype;
        if (
            !isObjectIdentity(prototype) ||
            !("getTreeList" in prototype) ||
            typeof prototype.getTreeList !== "function"
        )
            return undefined;

        try {
            Reflect.construct(Object, [], component);
        } catch {
            return undefined;
        }
        // SAFETY: The export is constructible in Pi's private module contract; its
        // returned selector and tree-list methods are validated before they are patched.
        // Pi 0.84.4 tree-selector.d.ts/js defines the constructor and getTreeList.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Export, prototype, getTreeList and constructability are checked; installed Pi's constructor contract establishes the callable signature that reflection cannot prove. Runtime contract and malformed-module tests cover this decoder.
        return module as TreeSelectorModule;
    },
};

export const treeThemeRuntime = {
    parse: (module: unknown): ThemeModule | undefined => {
        if (
            !isObjectIdentity(module) ||
            !("initTheme" in module) ||
            typeof module.initTheme !== "function" ||
            !("theme" in module)
        ) {
            return undefined;
        }

        if (!isObjectIdentity(module.theme)) return undefined;
        // SAFETY: initTheme is callable and theme is an object. Its proxy-backed methods
        // cannot be read until initialization, so the caller validates them immediately after initTheme.
        // Pi 0.84.4 theme.d.ts/js exports initTheme(themeName?, enableWatcher?) and a lazy Theme proxy.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: The callable initTheme and object theme exports are checked; installed Pi establishes the initialization signature, which reflection cannot prove. The caller validates lazy theme methods after initialization; malformed-module and installed-runtime tests cover this boundary.
        return module as ThemeModule;
    },
};

export async function loadTreeInternals(): Promise<[TreeSelectorModule, ThemeModule] | undefined> {
    const treeSelectorModule = await loadPiRuntimeModule(
        "modes/interactive/components/tree-selector.js",
        {
            scope: "pi-tree",
            feature: "tree selector patch",
            parse: treeSelectorRuntime.parse,
        },
    );
    if (treeSelectorModule === undefined) return undefined;

    const themeModule = await loadPiRuntimeModule("modes/interactive/theme/theme.js", {
        scope: "pi-tree",
        feature: "tree selector patch",
        parse: treeThemeRuntime.parse,
    });
    if (themeModule === undefined) return undefined;

    return [treeSelectorModule, themeModule];
}
