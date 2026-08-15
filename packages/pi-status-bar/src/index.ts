import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { installLoaderPatch } from "./loader-patch.ts";
import { setRightMessagesConfig } from "./right-message.ts";
import {
    DEFAULT_RIGHT_MESSAGES_CONFIG,
    loadStatusBarSettings,
    type LoadedStatusBarConfig,
} from "./settings.ts";
import { setStatusBarBaseConfig, subscribeStatusBarUpdates } from "./status-bar-api.ts";
import {
    clearWorkedForWidget,
    formatDuration,
    getWorkedForStateFromBranch,
    resetWorkedForWidgetCache,
    setWorkedForWidget,
    WORKED_FOR_STATE_ENTRY,
    type WorkedForState,
} from "./worked-for-widget.ts";

const reportedConfigErrors = new Set<string>();

function reportConfigErrors(ctx: ExtensionContext, loaded: LoadedStatusBarConfig): void {
    for (const error of loaded.errors) {
        if (reportedConfigErrors.has(error)) continue;
        reportedConfigErrors.add(error);
        ctx.ui.notify(`[pi-status-bar] ${error}`, "error");
    }
}

function applyStatusBarResolvedConfig(ctx: ExtensionContext): void {
    const loaded = loadStatusBarSettings(ctx.cwd, ctx.isProjectTrusted());
    setStatusBarBaseConfig(loaded.config.statusBar);
    setRightMessagesConfig(loaded.config.rightMessages);
    reportConfigErrors(ctx, loaded);
}

export default function statusBarExtension(pi: ExtensionAPI): void {
    const deactivateLoaderPatch = installLoaderPatch();

    let agentStartedAt: number | undefined;
    let messageStart: number | undefined;
    let streamStart: number | undefined;
    let totalOutputTokens = 0;
    let totalStreamMs = 0;
    let idleWidgetContext: ExtensionContext | undefined;
    let idleWorkedForText: string | undefined;
    let idleTokensPerSecond: number | undefined;
    let agentRunning = false;

    function restoreWorkedForState(ctx: ExtensionContext): void {
        const state = getWorkedForStateFromBranch(ctx);
        if (state === undefined) {
            idleWorkedForText = undefined;
            idleTokensPerSecond = undefined;
            return;
        }
        idleWorkedForText = formatDuration(state.durationMs);
        idleTokensPerSecond = state.tokensPerSecond;
    }

    subscribeStatusBarUpdates(() => {
        if (agentRunning || idleWidgetContext === undefined) return;
        setWorkedForWidget(idleWidgetContext, idleWorkedForText, idleTokensPerSecond);
    });

    pi.on("session_start", async (_event, ctx) => {
        applyStatusBarResolvedConfig(ctx);
        agentRunning = false;
        idleWidgetContext = ctx;
        resetWorkedForWidgetCache();
        restoreWorkedForState(ctx);
        setWorkedForWidget(ctx, idleWorkedForText, idleTokensPerSecond);
    });

    pi.on("session_tree", async (_event, ctx) => {
        if (agentRunning) return;
        idleWidgetContext = ctx;
        restoreWorkedForState(ctx);
        setWorkedForWidget(ctx, idleWorkedForText, idleTokensPerSecond);
    });

    pi.on("agent_start", async (_event, ctx) => {
        agentStartedAt = Date.now();
        messageStart = undefined;
        streamStart = undefined;
        totalOutputTokens = 0;
        totalStreamMs = 0;
        agentRunning = true;
        idleWidgetContext = ctx;
        idleWorkedForText = undefined;
        idleTokensPerSecond = undefined;
        clearWorkedForWidget(ctx);
    });

    pi.on("message_start", async (event) => {
        if (event.message.role !== "assistant") return;
        messageStart = Date.now();
        streamStart = undefined;
    });

    pi.on("message_update", async (event) => {
        if (event.message.role !== "assistant") return;
        const streamEvent = event.assistantMessageEvent;
        if (
            streamEvent.type !== "text_delta" &&
            streamEvent.type !== "thinking_delta" &&
            streamEvent.type !== "toolcall_delta"
        ) {
            return;
        }
        streamStart ??= Date.now();
    });

    pi.on("message_end", async (event) => {
        if (event.message.role !== "assistant") return;
        const outputTokens = event.message.usage.output;
        const timingStart = streamStart ?? messageStart;
        if (timingStart === undefined || outputTokens <= 0) {
            messageStart = undefined;
            streamStart = undefined;
            return;
        }
        totalOutputTokens += outputTokens;
        totalStreamMs += Math.max(0, Date.now() - timingStart);
        messageStart = undefined;
        streamStart = undefined;
    });

    pi.on("agent_end", async (_event, ctx) => {
        if (agentStartedAt === undefined) return;
        const duration = Math.max(0, Date.now() - agentStartedAt);
        const elapsedSeconds = totalStreamMs / 1000;
        let tokensPerSecond: number | undefined;
        if (totalOutputTokens > 0 && elapsedSeconds > 0) {
            tokensPerSecond = Math.round(totalOutputTokens / elapsedSeconds);
        }
        agentStartedAt = undefined;
        agentRunning = false;
        idleWidgetContext = ctx;
        idleWorkedForText = formatDuration(duration);
        idleTokensPerSecond = tokensPerSecond;
        const workedForState: WorkedForState = { durationMs: duration, tokensPerSecond };
        pi.appendEntry(WORKED_FOR_STATE_ENTRY, workedForState);
        setWorkedForWidget(ctx, idleWorkedForText, idleTokensPerSecond);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        agentStartedAt = undefined;
        messageStart = undefined;
        streamStart = undefined;
        totalOutputTokens = 0;
        totalStreamMs = 0;
        agentRunning = false;
        idleWidgetContext = undefined;
        idleWorkedForText = undefined;
        idleTokensPerSecond = undefined;
        setRightMessagesConfig(DEFAULT_RIGHT_MESSAGES_CONFIG);
        clearWorkedForWidget(ctx);
        deactivateLoaderPatch();
    });
}
