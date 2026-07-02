import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const THEME_FG_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.neutral-border-color-patched");

let neutralBorderColor = true;

type ThemePrototype = {
    [THEME_FG_PATCH_KEY]?: true;
    fg(this: ThemeInstance, color: string, text: string): string;
};

type ThemeInstance = {
    fg(color: string, text: string): string;
};

type ThemeModule = {
    Theme?: {
        prototype?: unknown;
    };
};

function warnNeutralBorderPatchUnavailable(error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(
        `[pi-ui-tweaks] neutral border color patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function isThemePrototype(value: unknown): value is ThemePrototype {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return typeof Reflect.get(value, "fg") === "function";
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

/**
 * Sets whether theme border colors should render as normal text color.
 */
export function setNeutralBorderColor(enabled: boolean): void {
    neutralBorderColor = enabled;
}

/**
 * Installs an idempotent patch that maps Pi border theme tokens away from blue.
 */
export async function installNeutralBorderColorPatch(): Promise<void> {
    try {
        const distDir = await resolvePiDistDir();
        const themePath = pathToFileURL(join(distDir, "modes/interactive/theme/theme.js")).href;
        const themeModule = (await import(themePath)) as ThemeModule;
        const prototype = themeModule.Theme?.prototype;
        if (!isThemePrototype(prototype)) {
            warnNeutralBorderPatchUnavailable();
            return;
        }
        if (prototype[THEME_FG_PATCH_KEY] === true) {
            return;
        }

        const originalFgValue: unknown = Reflect.get(prototype, "fg");
        if (typeof originalFgValue !== "function") {
            warnNeutralBorderPatchUnavailable();
            return;
        }
        const originalFg = originalFgValue as ThemePrototype["fg"];
        prototype.fg = function neutralBorderFg(
            this: ThemeInstance,
            color: string,
            text: string,
        ): string {
            if (neutralBorderColor && (color === "border" || color === "borderMuted")) {
                return originalFg.call(this, "text", text);
            }
            return originalFg.call(this, color, text);
        };
        prototype[THEME_FG_PATCH_KEY] = true;
    } catch (error: unknown) {
        warnNeutralBorderPatchUnavailable(error);
    }
}
