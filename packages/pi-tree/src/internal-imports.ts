import { loadPiInternalModule } from "@zigai/pi-extension-internals";

export type TreeSelectorModule = {
    TreeSelectorComponent: new (
        entries: unknown[],
        selectedId: string | null,
        height: number,
        onSelect: () => undefined,
        onCancel: () => undefined,
        onLabel: () => undefined,
        onDelete: undefined,
        onFork: undefined,
    ) => { getTreeList?: () => unknown };
};

export type ThemeModule = {
    initTheme: (name: string | undefined, force: boolean) => void;
    theme: {
        fg: (role: string, text: string) => string;
        bg: (role: string, text: string) => string;
        bold: (text: string) => string;
    };
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function isTreeSelectorModule(value: unknown): value is TreeSelectorModule {
    return typeof getUnknownProperty(value, "TreeSelectorComponent") === "function";
}

function isThemeModule(value: unknown): value is ThemeModule {
    const theme = getUnknownProperty(value, "theme");
    return (
        typeof getUnknownProperty(value, "initTheme") === "function" &&
        typeof getUnknownProperty(theme, "fg") === "function" &&
        typeof getUnknownProperty(theme, "bg") === "function" &&
        typeof getUnknownProperty(theme, "bold") === "function"
    );
}

export async function loadTreeInternals(): Promise<[TreeSelectorModule, ThemeModule] | undefined> {
    const treeSelectorModule = await loadPiInternalModule(
        "modes/interactive/components/tree-selector.js",
        {
            scope: "pi-tree",
            feature: "tree selector patch",
            parse: (module) => {
                if (isTreeSelectorModule(module)) return module;
                return undefined;
            },
        },
    );
    if (treeSelectorModule === undefined) return undefined;

    const themeModule = await loadPiInternalModule("modes/interactive/theme/theme.js", {
        scope: "pi-tree",
        feature: "tree selector patch",
        parse: (module) => {
            if (isThemeModule(module)) return module;
            return undefined;
        },
    });
    if (themeModule === undefined) return undefined;

    return [treeSelectorModule, themeModule];
}
