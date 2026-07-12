import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ThemeModule, TreeSelectorModule } from "./types.ts";

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

export function warnInternalPatchUnavailable(feature: string, error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(`[pi-tree] ${feature} unavailable; Pi internals may have changed${suffix}`);
}

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

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export async function loadTreeInternals(): Promise<[TreeSelectorModule, ThemeModule] | undefined> {
    try {
        const distDir = await resolvePiDistDir();
        const treeSelectorPath = pathToFileURL(
            join(distDir, "modes/interactive/components/tree-selector.js"),
        ).href;
        const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;

        const imports: unknown = await Promise.all([import(treeSelectorPath), import(themePath)]);
        if (!isUnknownArray(imports)) {
            warnInternalPatchUnavailable("tree selector patch");
            return undefined;
        }
        const treeSelectorModule = imports[0];
        const themeModule = imports[1];
        if (!isTreeSelectorModule(treeSelectorModule) || !isThemeModule(themeModule)) {
            warnInternalPatchUnavailable("tree selector patch");
            return undefined;
        }
        return [treeSelectorModule, themeModule];
    } catch (error: unknown) {
        warnInternalPatchUnavailable("tree selector patch", error);
        return undefined;
    }
}
