import { Editor, getKeybindings } from "@earendil-works/pi-tui";

import { getUiTweaksPatchState } from "./patch-state.ts";
import { recordRenderTraceMarker } from "./render-trace.ts";

const AUTOCOMPLETE_POSITION_PATCHED = Symbol.for(
    "zigai.pi-ui-tweaks.autocomplete-position-patched",
);
const AUTOCOMPLETE_RENDERED_ABOVE = Symbol.for("zigai.pi-ui-tweaks.autocomplete-rendered-above");
const AUTOCOMPLETE_RESTORE_RENDER_PENDING = Symbol.for(
    "zigai.pi-ui-tweaks.autocomplete-restore-render-pending",
);
const AUTOCOMPLETE_SKIP_RESTORE_ON_CLOSE = Symbol.for(
    "zigai.pi-ui-tweaks.autocomplete-skip-restore-on-close",
);

function blankSpacerLine(width: number): string {
    const visibleSpacer = "\x1b[0m \x1b[0m";
    if (width <= 1) {
        return visibleSpacer;
    }
    return visibleSpacer + " ".repeat(width - 1);
}

type AutocompleteListLike = {
    getSelectedItem?(): unknown;
    render(width: number): string[];
};

type AutocompletePositionPatchTarget = {
    render(width: number): string[];
    autocompleteState?: unknown;
    autocompleteList?: AutocompleteListLike;
    autocompletePrefix?: string;
    autocompleteProvider?: unknown;
    handleInput?(data: string): void;
    paddingX?: number;
    tui?: { requestRender(force?: boolean): void };
    [AUTOCOMPLETE_POSITION_PATCHED]?: true;
    [AUTOCOMPLETE_RENDERED_ABOVE]?: true;
    [AUTOCOMPLETE_RESTORE_RENDER_PENDING]?: true;
    [AUTOCOMPLETE_SKIP_RESTORE_ON_CLOSE]?: true;
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

function requestDeferredForceRender(target: AutocompletePositionPatchTarget): void {
    const tui = target.tui;
    if (tui === undefined) return;
    if (target[AUTOCOMPLETE_RESTORE_RENDER_PENDING] === true) return;

    target[AUTOCOMPLETE_RESTORE_RENDER_PENDING] = true;
    setImmediate(() => {
        target[AUTOCOMPLETE_RESTORE_RENDER_PENDING] = undefined;
        recordRenderTraceMarker("autocomplete-force-render-requested", tui);
        tui.requestRender(true);
    });
}

function getSelectedAutocompleteItem(target: AutocompletePositionPatchTarget): unknown {
    const autocompleteList = target.autocompleteList;
    if (autocompleteList === undefined) return undefined;

    const getSelectedItem: unknown = Reflect.get(autocompleteList, "getSelectedItem");
    if (typeof getSelectedItem !== "function") return undefined;

    const selectedItem: unknown = Reflect.apply(getSelectedItem, autocompleteList, []);
    if (selectedItem === undefined || selectedItem === null) return undefined;
    return selectedItem;
}

function isAutocompleteCompletion(target: AutocompletePositionPatchTarget, data: string): boolean {
    if (!getUiTweaksPatchState().autocompleteAboveInput) return false;
    if (target.autocompleteState === null || target.autocompleteState === undefined) return false;
    if (target.autocompleteProvider === undefined) return false;
    if (
        !getKeybindings().matches(data, "tui.input.tab") &&
        !getKeybindings().matches(data, "tui.select.confirm")
    ) {
        return false;
    }
    return getSelectedAutocompleteItem(target) !== undefined;
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
    prototype?: AutocompletePositionPatchTarget,
): void {
    const prototypeValue: unknown = prototype ?? Editor.prototype;
    if (
        (typeof prototypeValue !== "object" && typeof prototypeValue !== "function") ||
        prototypeValue === null
    ) {
        warnAutocompletePositionPatchUnavailable();
        return;
    }
    const originalRenderValue: unknown = Reflect.get(prototypeValue, "render") as unknown;
    if (typeof originalRenderValue !== "function") {
        warnAutocompletePositionPatchUnavailable("missing render");
        return;
    }
    // SAFETY: The guarded pi-tui Editor adapter verifies the private render seam
    // before exposing the smallest autocomplete-position patch target.
    prototype = prototypeValue as AutocompletePositionPatchTarget;
    if (prototype[AUTOCOMPLETE_POSITION_PATCHED] === true) return;
    // SAFETY: The immediately preceding runtime guard proves the private Editor render seam is callable.
    const originalRender = originalRenderValue as AutocompletePositionPatchTarget["render"];
    const originalHandleInputValue: unknown = Reflect.get(prototype, "handleInput");
    if (typeof originalHandleInputValue === "function") {
        // SAFETY: The immediately preceding runtime guard proves the private Editor handleInput seam is callable.
        const originalHandleInput = originalHandleInputValue as (
            this: AutocompletePositionPatchTarget,
            data: string,
        ) => void;
        prototype.handleInput = function autocompletePositionHandleInput(
            this: AutocompletePositionPatchTarget,
            data: string,
        ): void {
            if (isAutocompleteCompletion(this, data)) {
                this[AUTOCOMPLETE_SKIP_RESTORE_ON_CLOSE] = true;
            }
            let completed = false;
            try {
                originalHandleInput.call(this, data);
                completed = true;
            } finally {
                if (
                    !completed ||
                    (this.autocompleteState !== null && this.autocompleteState !== undefined)
                ) {
                    this[AUTOCOMPLETE_SKIP_RESTORE_ON_CLOSE] = undefined;
                }
            }
        };
    }
    prototype.render = function autocompletePositionRender(
        this: AutocompletePositionPatchTarget,
        width: number,
    ): string[] {
        const result = originalRender.call(this, width);
        const patchState = getUiTweaksPatchState();
        if (!patchState.autocompleteAboveInput) {
            if (this[AUTOCOMPLETE_RENDERED_ABOVE] === true) {
                this[AUTOCOMPLETE_RENDERED_ABOVE] = undefined;
                if (patchState.restoreContentAfterAutocompleteClose) {
                    requestDeferredForceRender(this);
                }
            }
            return result;
        }

        const autocompleteLineCount = getAutocompleteLineCount(this, width);
        if (autocompleteLineCount === 0 || autocompleteLineCount >= result.length) {
            if (this[AUTOCOMPLETE_RENDERED_ABOVE] === true) {
                this[AUTOCOMPLETE_RENDERED_ABOVE] = undefined;
                recordRenderTraceMarker("autocomplete-close-detected", this.tui);
                const skipRestore = this[AUTOCOMPLETE_SKIP_RESTORE_ON_CLOSE] === true;
                this[AUTOCOMPLETE_SKIP_RESTORE_ON_CLOSE] = undefined;
                if (patchState.restoreContentAfterAutocompleteClose && !skipRestore) {
                    requestDeferredForceRender(this);
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
