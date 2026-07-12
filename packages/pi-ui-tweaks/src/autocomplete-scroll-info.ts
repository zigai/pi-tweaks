import { SelectList } from "@earendil-works/pi-tui";

import { getUiTweaksPatchState } from "./patch-state.ts";

const AUTOCOMPLETE_SCROLL_INFO_PATCHED = Symbol.for(
    "zigai.pi-ui-tweaks.autocomplete-scroll-info-patched",
);

type SelectListScrollInfoTarget = {
    [AUTOCOMPLETE_SCROLL_INFO_PATCHED]?: true;
    filteredItems: readonly unknown[];
    maxVisible: number;
    render: (this: SelectListScrollInfoTarget, width: number) => string[];
    selectedIndex: number;
};

function warnAutocompleteScrollInfoPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined) {
        suffix = `: ${reason}`;
    }
    console.warn(
        `[pi-ui-tweaks] autocomplete scroll info patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function shouldRenderScrollInfo(target: SelectListScrollInfoTarget): boolean {
    if (target.filteredItems.length === 0) return false;

    const startIndex = Math.max(
        0,
        Math.min(
            target.selectedIndex - Math.floor(target.maxVisible / 2),
            target.filteredItems.length - target.maxVisible,
        ),
    );
    const endIndex = Math.min(startIndex + target.maxVisible, target.filteredItems.length);
    if (startIndex > 0) return true;
    return endIndex < target.filteredItems.length;
}

/**
 * Sets whether autocomplete menus should hide their scroll/count footer.
 */
export function setHideAutocompleteScrollInfo(enabled: boolean): void {
    getUiTweaksPatchState().hideAutocompleteScrollInfo = enabled;
}

/**
 * Installs an idempotent patch that removes autocomplete scroll/count footer rows.
 */
export function installAutocompleteScrollInfoPatch(prototype?: SelectListScrollInfoTarget): void {
    const prototypeValue: unknown = prototype ?? SelectList.prototype;
    if (
        (typeof prototypeValue !== "object" && typeof prototypeValue !== "function") ||
        prototypeValue === null
    ) {
        warnAutocompleteScrollInfoPatchUnavailable();
        return;
    }
    const originalRenderValue: unknown = Reflect.get(prototypeValue, "render") as unknown;
    if (typeof originalRenderValue !== "function") {
        warnAutocompleteScrollInfoPatchUnavailable("missing render");
        return;
    }
    // SAFETY: The guarded pi-tui SelectList adapter verifies the private render
    // seam before exposing its smallest autocomplete scroll-info patch target.
    prototype = prototypeValue as SelectListScrollInfoTarget;
    if (prototype[AUTOCOMPLETE_SCROLL_INFO_PATCHED] === true) return;
    // SAFETY: The immediately preceding runtime guard proves the private SelectList render seam is callable.
    const originalRender = originalRenderValue as SelectListScrollInfoTarget["render"];
    prototype.render = function autocompleteScrollInfoRender(
        this: SelectListScrollInfoTarget,
        width: number,
    ): string[] {
        const lines = originalRender.call(this, width);
        if (!getUiTweaksPatchState().hideAutocompleteScrollInfo) return lines;
        if (!shouldRenderScrollInfo(this)) return lines;
        return lines.slice(0, -1);
    };
    prototype[AUTOCOMPLETE_SCROLL_INFO_PATCHED] = true;
}
