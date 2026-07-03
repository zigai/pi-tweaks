const UI_TWEAKS_PATCH_STATE_KEY = Symbol.for("zigai.pi-ui-tweaks.patch-state");

export const DEFAULT_INPUT_PROMPT_PREFIX = "> ";
export const DEFAULT_SELECTED_OPTION_PREFIX = "→ ";

export type UiTweaksPatchState = {
    autocompleteAboveInput: boolean;
    restoreContentAfterAutocompleteClose: boolean;
    hideAutocompleteScrollInfo: boolean;
    anchorInputToBottom: boolean;
    inputPromptPrefix: string;
    compactModelSelector: boolean;
    hideModelProviderHint: boolean;
    highlightSelectedModelProvider: boolean;
    hideModelChangeStatus: boolean;
    selectedOptionPrefix: string;
    hideSlashCommandSourceTags: boolean;
    neutralBorderColor: boolean;
    bashExecPromptSpacing: boolean;
};

const DEFAULT_UI_TWEAKS_PATCH_STATE: UiTweaksPatchState = {
    autocompleteAboveInput: true,
    restoreContentAfterAutocompleteClose: true,
    hideAutocompleteScrollInfo: true,
    anchorInputToBottom: false,
    inputPromptPrefix: DEFAULT_INPUT_PROMPT_PREFIX,
    compactModelSelector: true,
    hideModelProviderHint: true,
    highlightSelectedModelProvider: true,
    hideModelChangeStatus: true,
    selectedOptionPrefix: DEFAULT_SELECTED_OPTION_PREFIX,
    hideSlashCommandSourceTags: true,
    neutralBorderColor: true,
    bashExecPromptSpacing: true,
};

function isUiTweaksPatchState(value: unknown): value is UiTweaksPatchState {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return (
        typeof Reflect.get(value, "autocompleteAboveInput") === "boolean" &&
        typeof Reflect.get(value, "restoreContentAfterAutocompleteClose") === "boolean" &&
        typeof Reflect.get(value, "hideAutocompleteScrollInfo") === "boolean" &&
        typeof Reflect.get(value, "anchorInputToBottom") === "boolean" &&
        typeof Reflect.get(value, "inputPromptPrefix") === "string" &&
        typeof Reflect.get(value, "compactModelSelector") === "boolean" &&
        typeof Reflect.get(value, "hideModelProviderHint") === "boolean" &&
        typeof Reflect.get(value, "highlightSelectedModelProvider") === "boolean" &&
        typeof Reflect.get(value, "hideModelChangeStatus") === "boolean" &&
        typeof Reflect.get(value, "selectedOptionPrefix") === "string" &&
        typeof Reflect.get(value, "hideSlashCommandSourceTags") === "boolean" &&
        typeof Reflect.get(value, "neutralBorderColor") === "boolean" &&
        typeof Reflect.get(value, "bashExecPromptSpacing") === "boolean"
    );
}

export function getUiTweaksPatchState(): UiTweaksPatchState {
    const existingState: unknown = Reflect.get(globalThis, UI_TWEAKS_PATCH_STATE_KEY);
    if (isUiTweaksPatchState(existingState)) {
        return existingState;
    }

    const state = { ...DEFAULT_UI_TWEAKS_PATCH_STATE };
    Reflect.set(globalThis, UI_TWEAKS_PATCH_STATE_KEY, state);
    return state;
}
