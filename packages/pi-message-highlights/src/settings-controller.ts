import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG,
    loadMessageHighlightsSettings,
    type LoadedMessageHighlightsConfig,
    type MessageHighlightsConfig,
} from "./settings.ts";

export class MessageHighlightSettingsController {
    private activeConfig = DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG;
    private readonly reportedErrors = new Set<string>();

    getConfig = (): MessageHighlightsConfig => this.activeConfig;

    apply(ctx: ExtensionContext): void {
        const loaded = loadMessageHighlightsSettings(ctx.cwd, ctx.isProjectTrusted());
        this.activeConfig = loaded.config;
        this.reportErrors(ctx, loaded);
    }

    private reportErrors(ctx: ExtensionContext, loaded: LoadedMessageHighlightsConfig): void {
        for (const error of loaded.errors) {
            if (this.reportedErrors.has(error)) continue;
            this.reportedErrors.add(error);
            ctx.ui.notify(`[pi-message-highlights] ${error}`, "error");
        }
    }
}

export const messageHighlightSettings = new MessageHighlightSettingsController();
