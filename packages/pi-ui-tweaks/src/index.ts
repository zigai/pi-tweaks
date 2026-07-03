import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    installAutocompletePositionPatch,
    setAutocompleteAboveInput,
    setRestoreContentAfterAutocompleteClose,
} from "./autocomplete-position.ts";
import {
    installAutocompleteScrollInfoPatch,
    setHideAutocompleteScrollInfo,
} from "./autocomplete-scroll-info.ts";
import { applyBashExecSpacingEditor, setBashExecPromptSpacing } from "./bash-exec-spacing.ts";
import {
    installAnchorInputToBottomPatch,
    setAnchorInputToBottom,
} from "./anchor-input-to-bottom.ts";
import { installNeutralBorderColorPatch, setNeutralBorderColor } from "./border-color.ts";
import { installInputPromptPrefixPatch, setInputPromptPrefix } from "./input-prompt-prefix.ts";
import {
    installModelSelectorHintPatch,
    setCompactModelSelector,
    setHideModelProviderHint,
} from "./model-selector-hint.ts";
import {
    installModelSelectorProviderBadgePatch,
    setHighlightSelectedModelProvider,
} from "./model-selector-provider-badge.ts";
import { installModelStatusPatch, setHideModelChangeStatus } from "./model-status.ts";
import {
    installSelectedOptionPrefixSelectListPatch,
    installSelectedOptionPrefixThemePatch,
    setSelectedOptionPrefix,
} from "./selected-option-prefix.ts";
import { loadUiTweaksConfig, type LoadedUiTweaksConfig } from "./settings.ts";
import {
    installSlashCommandSourcePatch,
    setHideSlashCommandSourceTags,
} from "./slash-command-source.ts";

const reportedConfigErrors = new Set<string>();

function reportConfigErrors(ctx: ExtensionContext, loaded: LoadedUiTweaksConfig): void {
    for (const error of loaded.errors) {
        if (reportedConfigErrors.has(error)) {
            continue;
        }
        reportedConfigErrors.add(error);
        ctx.ui.notify(`[pi-ui-tweaks] ${error}`, "error");
    }
}

function applyUiTweaksConfig(ctx: ExtensionContext): void {
    const loaded = loadUiTweaksConfig(ctx.cwd, ctx.isProjectTrusted());
    setAutocompleteAboveInput(loaded.config.autocompleteAboveInput);
    setBashExecPromptSpacing(loaded.config.bashExecPromptSpacing);
    setAnchorInputToBottom(loaded.config.anchorInputToBottom);
    setCompactModelSelector(loaded.config.compactModelSelector);
    setHideAutocompleteScrollInfo(loaded.config.hideAutocompleteScrollInfo);
    setHideModelChangeStatus(loaded.config.hideModelChangeStatus);
    setHideModelProviderHint(loaded.config.hideModelProviderHint);
    setHideSlashCommandSourceTags(loaded.config.hideSlashCommandSourceTags);
    setHighlightSelectedModelProvider(loaded.config.highlightSelectedModelProvider);
    setInputPromptPrefix(loaded.config.inputPromptPrefix);
    setNeutralBorderColor(loaded.config.neutralBorderColor);
    setRestoreContentAfterAutocompleteClose(loaded.config.restoreContentAfterAutocompleteClose);
    setSelectedOptionPrefix(loaded.config.selectedOptionPrefix);
    reportConfigErrors(ctx, loaded);
}

/**
 * Installs small configurable Pi UI tweaks.
 */
export default function uiTweaksExtension(pi: ExtensionAPI): void {
    installAutocompletePositionPatch();
    installAutocompleteScrollInfoPatch();
    installAnchorInputToBottomPatch();
    installInputPromptPrefixPatch();
    installModelSelectorHintPatch();
    void installModelSelectorProviderBadgePatch();
    installModelStatusPatch();
    installSelectedOptionPrefixSelectListPatch();
    installSlashCommandSourcePatch();
    void installNeutralBorderColorPatch();
    void installSelectedOptionPrefixThemePatch();

    pi.on("session_start", (_event, ctx) => {
        applyUiTweaksConfig(ctx);
        applyBashExecSpacingEditor(ctx);
    });
}
