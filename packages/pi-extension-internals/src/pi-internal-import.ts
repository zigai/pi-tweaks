import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type PiInternalModuleLoadOptions<T> = {
    readonly scope: string;
    readonly feature: string;
    readonly parse: (module: unknown) => T | undefined;
};

/** Resolves a path relative to the installed Pi coding-agent distribution. */
function resolvePiInternalModuleUrl(relativePath: string): string {
    const codingAgentDirectory = resolve(getPackageDir(), "dist");
    if (relativePath.length === 0 || isAbsolute(relativePath)) {
        throw new TypeError("Pi internal module path must be relative to the coding-agent package");
    }
    const modulePath = resolve(codingAgentDirectory, relativePath);
    const pathWithinPackage = relative(codingAgentDirectory, modulePath);
    if (
        pathWithinPackage.length === 0 ||
        pathWithinPackage === ".." ||
        pathWithinPackage.startsWith(`..${sep}`) ||
        isAbsolute(pathWithinPackage)
    ) {
        throw new TypeError("Pi internal module path escapes the coding-agent package");
    }
    return pathToFileURL(modulePath).href;
}

/** Reports a disabled best-effort patch without interrupting extension startup. */
export function warnPiInternalPatchUnavailable(
    scope: string,
    feature: string,
    cause?: unknown,
): void {
    let suffix = "";
    if (cause instanceof Error && cause.message.length > 0) {
        suffix = `: ${cause.message}`;
    }
    console.warn(`[${scope}] ${feature} unavailable; Pi internals may have changed${suffix}`);
}

/** Loads and parses an unsupported Pi internal module, degrading to undefined on failure. */
export async function loadPiInternalModule<T>(
    relativePath: string,
    options: PiInternalModuleLoadOptions<T>,
): Promise<T | undefined> {
    try {
        const moduleUrl = resolvePiInternalModuleUrl(relativePath);
        const imported: unknown = await import(moduleUrl);
        const parsed = options.parse(imported);
        if (parsed !== undefined) {
            return parsed;
        }
        warnPiInternalPatchUnavailable(options.scope, options.feature);
        return undefined;
    } catch (cause: unknown) {
        warnPiInternalPatchUnavailable(options.scope, options.feature, cause);
        return undefined;
    }
}
