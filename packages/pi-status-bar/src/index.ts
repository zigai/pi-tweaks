import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { installLoaderPatch } from "./loader-patch.ts";
import { setRightMessagesConfig } from "./right-message.ts";
import {
    DEFAULT_RIGHT_MESSAGES_CONFIG,
    loadStatusBarSettings,
    type LoadedStatusBarConfig,
} from "./settings.ts";
import { setStatusBarBaseConfig, subscribeStatusBarUpdates } from "./status-bar-api.ts";
import { isProviderOutputEvent, TurnTokenThroughputTracker } from "./token-throughput.ts";
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

    let runStartedAt: number | undefined;
    const throughput = new TurnTokenThroughputTracker();
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

    const unsubscribeStatusBarUpdates = subscribeStatusBarUpdates(() => {
        if (agentRunning || idleWidgetContext === undefined) return;
        setWorkedForWidget(idleWidgetContext, idleWorkedForText, idleTokensPerSecond);
    });

    pi.on("session_start", async (_event, ctx) => {
        applyStatusBarResolvedConfig(ctx);
        runStartedAt = undefined;
        throughput.reset();
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
        if (runStartedAt === undefined) {
            runStartedAt = performance.now();
            throughput.reset();
            idleWorkedForText = undefined;
            idleTokensPerSecond = undefined;
        }
        agentRunning = true;
        idleWidgetContext = ctx;
        clearWorkedForWidget(ctx);
    });

    pi.on("message_start", async (event) => {
        if (event.message.role === "user") {
            throughput.reset();
            return;
        }
        if (event.message.role === "assistant") {
            throughput.startStep();
        }
    });

    pi.on("message_update", async (event) => {
        if (event.message.role !== "assistant") return;
        if (!isProviderOutputEvent(event.assistantMessageEvent.type)) return;
        throughput.markOutput(performance.now());
    });

    pi.on("message_end", async (event) => {
        if (event.message.role !== "assistant") return;
        throughput.finishStep(performance.now(), event.message.usage);
    });

    pi.on("agent_settled", async (_event, ctx) => {
        if (runStartedAt === undefined || !ctx.isIdle()) return;

        const duration = Math.max(0, performance.now() - runStartedAt);
        const throughputResult = throughput.result();
        let tokensPerSecond: number | undefined;
        if (throughputResult.status === "available") {
            tokensPerSecond = throughputResult.measurement.tokensPerSecond;
        }

        runStartedAt = undefined;
        agentRunning = false;
        idleWidgetContext = ctx;
        idleWorkedForText = formatDuration(duration);
        idleTokensPerSecond = tokensPerSecond;
        const workedForState: WorkedForState = { durationMs: duration, tokensPerSecond };
        pi.appendEntry(WORKED_FOR_STATE_ENTRY, workedForState);
        setWorkedForWidget(ctx, idleWorkedForText, idleTokensPerSecond);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        runStartedAt = undefined;
        throughput.reset();
        agentRunning = false;
        idleWidgetContext = undefined;
        idleWorkedForText = undefined;
        idleTokensPerSecond = undefined;
        setRightMessagesConfig(DEFAULT_RIGHT_MESSAGES_CONFIG);
        clearWorkedForWidget(ctx);
        unsubscribeStatusBarUpdates();
        deactivateLoaderPatch();
    });
}
