import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { installModelSelectorHintPatch, setHideModelProviderHint } from "./model-selector-hint.ts";
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
    setHideModelProviderHint(loaded.config.hideModelProviderHint);
    setHideSlashCommandSourceTags(loaded.config.hideSlashCommandSourceTags);
    reportConfigErrors(ctx, loaded);
}

/**
 * Installs small configurable Pi UI tweaks.
 */
export default function uiTweaksExtension(pi: ExtensionAPI): void {
    installModelSelectorHintPatch();
    installSlashCommandSourcePatch();

    pi.on("session_start", (_event, ctx) => {
        applyUiTweaksConfig(ctx);
    });
}
