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
    applyPasteCollapseEditor,
    installPasteCollapsePatch,
    setPasteCollapseSettings,
} from "./paste-collapse.ts";
import {
    installPreserveCompactionHistoryPatch,
    setPreserveCompactionHistory,
} from "./preserve-compaction-history.ts";
import { installRenderTracePatch } from "./render-trace.ts";
import {
    installSelectedOptionPrefixSelectListPatch,
    installSelectedOptionPrefixThemePatch,
    setSelectedOptionPrefix,
} from "./selected-option-prefix.ts";
import { loadUiTweaksSettings, type LoadedUiTweaksConfig } from "./settings.ts";
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
    const loaded = loadUiTweaksSettings(ctx.cwd, ctx.isProjectTrusted());
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
    setPasteCollapseSettings({
        pasteCollapseCharThreshold: loaded.config.pasteCollapseCharThreshold,
        pasteCollapseEnabled: loaded.config.pasteCollapseEnabled,
        pasteCollapseExpandKey: loaded.config.pasteCollapseExpandKey,
        pasteCollapseLineThreshold: loaded.config.pasteCollapseLineThreshold,
        pasteCollapseUseToolExpandKey: loaded.config.pasteCollapseUseToolExpandKey,
    });
    setPreserveCompactionHistory(loaded.config.preserveCompactionHistory);
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
    installPasteCollapsePatch();
    installPreserveCompactionHistoryPatch();
    installSelectedOptionPrefixSelectListPatch();
    installSlashCommandSourcePatch();
    void installNeutralBorderColorPatch();
    void installSelectedOptionPrefixThemePatch();
    let renderTrace: ReturnType<typeof installRenderTracePatch>;

    pi.on("session_start", (_event, ctx) => {
        renderTrace = installRenderTracePatch();
        applyUiTweaksConfig(ctx);
        applyBashExecSpacingEditor(ctx);
        applyPasteCollapseEditor(ctx);
        if (renderTrace !== undefined) {
            ctx.ui.notify(`[pi-ui-tweaks] render trace: ${renderTrace.filePath}`, "info");
        }
    });

    pi.on("session_shutdown", () => {
        renderTrace?.stop();
        renderTrace = undefined;
    });
}
