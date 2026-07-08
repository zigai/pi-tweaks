import { Editor } from "@earendil-works/pi-tui";

import { getUiTweaksPatchState } from "./patch-state.ts";

const AUTOCOMPLETE_POSITION_PATCHED = Symbol.for(
    "zigai.pi-ui-tweaks.autocomplete-position-patched",
);
const AUTOCOMPLETE_RENDERED_ABOVE = Symbol.for("zigai.pi-ui-tweaks.autocomplete-rendered-above");

function blankSpacerLine(width: number): string {
    const visibleSpacer = "\x1b[0m \x1b[0m";
    if (width <= 1) {
        return visibleSpacer;
    }
    return visibleSpacer + " ".repeat(width - 1);
}

type AutocompleteListLike = {
    render(width: number): string[];
};

type AutocompletePositionPatchTarget = {
    render(width: number): string[];
    autocompleteState?: unknown;
    autocompleteList?: AutocompleteListLike;
    paddingX?: number;
    tui?: { requestRender(force?: boolean): void };
    [AUTOCOMPLETE_POSITION_PATCHED]?: true;
    [AUTOCOMPLETE_RENDERED_ABOVE]?: true;
};

function warnAutocompletePositionPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined) {
        suffix = `: ${reason}`;
    }
    console.warn(
        `[pi-ui-tweaks] autocomplete position patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function getAutocompleteLineCount(target: AutocompletePositionPatchTarget, width: number): number {
    const autocompleteList = target.autocompleteList;
    if (target.autocompleteState === null || autocompleteList === undefined) {
        return 0;
    }

    const rawPaddingX = target.paddingX ?? 0;
    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const paddingX = Math.min(rawPaddingX, maxPadding);
    const contentWidth = Math.max(1, width - paddingX * 2);
    return autocompleteList.render(contentWidth).length;
}

/**
 * Sets whether editor autocomplete rows should render above the input box.
 */
export function setAutocompleteAboveInput(enabled: boolean): void {
    getUiTweaksPatchState().autocompleteAboveInput = enabled;
}

/**
 * Sets whether closing above-input autocomplete should force a clean redraw.
 */
export function setRestoreContentAfterAutocompleteClose(enabled: boolean): void {
    getUiTweaksPatchState().restoreContentAfterAutocompleteClose = enabled;
}

/**
 * Installs an idempotent patch that moves editor autocomplete rows above the input box.
 */
export function installAutocompletePositionPatch(
    prototype: AutocompletePositionPatchTarget = Editor.prototype as unknown as AutocompletePositionPatchTarget,
): void {
    if (prototype[AUTOCOMPLETE_POSITION_PATCHED] === true) return;

    const originalRenderValue: unknown = Reflect.get(prototype, "render");
    if (typeof originalRenderValue !== "function") {
        warnAutocompletePositionPatchUnavailable("missing render");
        return;
    }

    const originalRender = originalRenderValue as AutocompletePositionPatchTarget["render"];
    prototype.render = function autocompletePositionRender(
        this: AutocompletePositionPatchTarget,
        width: number,
    ): string[] {
        const result = originalRender.call(this, width);
        const patchState = getUiTweaksPatchState();
        if (!patchState.autocompleteAboveInput) {
            this[AUTOCOMPLETE_RENDERED_ABOVE] = undefined;
            return result;
        }

        const autocompleteLineCount = getAutocompleteLineCount(this, width);
        if (autocompleteLineCount === 0 || autocompleteLineCount >= result.length) {
            if (this[AUTOCOMPLETE_RENDERED_ABOVE] === true) {
                this[AUTOCOMPLETE_RENDERED_ABOVE] = undefined;
                if (patchState.restoreContentAfterAutocompleteClose) {
                    this.tui?.requestRender(true);
                }
            }
            return result;
        }

        const editorLines = result.slice(0, result.length - autocompleteLineCount);
        const autocompleteLines = result.slice(result.length - autocompleteLineCount);
        this[AUTOCOMPLETE_RENDERED_ABOVE] = true;
        return [blankSpacerLine(width), ...autocompleteLines, ...editorLines];
    };
    prototype[AUTOCOMPLETE_POSITION_PATCHED] = true;
}
