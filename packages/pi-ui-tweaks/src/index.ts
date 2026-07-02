import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { applyBashExecSpacingEditor, setBashExecPromptSpacing } from "./bash-exec-spacing.ts";
import { installNeutralBorderColorPatch, setNeutralBorderColor } from "./border-color.ts";
import {
    installModelSelectorHintPatch,
    setCompactModelSelector,
    setHideModelProviderHint,
} from "./model-selector-hint.ts";
import { installModelStatusPatch, setHideModelChangeStatus } from "./model-status.ts";
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
    setBashExecPromptSpacing(loaded.config.bashExecPromptSpacing);
    setCompactModelSelector(loaded.config.compactModelSelector);
    setHideModelChangeStatus(loaded.config.hideModelChangeStatus);
    setHideModelProviderHint(loaded.config.hideModelProviderHint);
    setHideSlashCommandSourceTags(loaded.config.hideSlashCommandSourceTags);
    setNeutralBorderColor(loaded.config.neutralBorderColor);
    reportConfigErrors(ctx, loaded);
}

/**
 * Installs small configurable Pi UI tweaks.
 */
export default function uiTweaksExtension(pi: ExtensionAPI): void {
    installModelSelectorHintPatch();
    installModelStatusPatch();
    installSlashCommandSourcePatch();
    void installNeutralBorderColorPatch();

    pi.on("session_start", (_event, ctx) => {
        applyUiTweaksConfig(ctx);
        applyBashExecSpacingEditor(ctx);
    });
}
