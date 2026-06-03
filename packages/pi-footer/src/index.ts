import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createFooterComponent } from "./footer-rendering.ts";
import { formatDuration, setWorkedForWidget } from "./worked-for-widget.ts";

export default function uiEnhancements(pi: ExtensionAPI) {
    let agentStartedAt: number | undefined;
    let messageStart: number | undefined;
    let streamStart: number | undefined;
    let estimatedStreamedTokens = 0;
    let totalOutputTokens = 0;
    let totalStreamMs = 0;

    const installFooter = (ctx: ExtensionContext) => {
        ctx.ui.setFooter((tui, _theme, footerData) =>
            createFooterComponent(
                ctx,
                footerData,
                () => pi.getThinkingLevel(),
                () => tui.requestRender(),
            ),
        );
    };

    pi.on("session_start", async (_event, ctx) => {
        installFooter(ctx);
        setWorkedForWidget(ctx, undefined);
    });

    pi.on("agent_start", async (_event, ctx) => {
        agentStartedAt = Date.now();
        messageStart = undefined;
        streamStart = undefined;
        estimatedStreamedTokens = 0;
        totalOutputTokens = 0;
        totalStreamMs = 0;
        setWorkedForWidget(ctx, undefined);
    });

    pi.on("message_start", async (event) => {
        if (event.message.role !== "assistant") return;
        messageStart = Date.now();
        streamStart = undefined;
        estimatedStreamedTokens = 0;
    });

    pi.on("message_update", async (event) => {
        if (event.message.role !== "assistant") return;

        const streamEvent = event.assistantMessageEvent;
        const isOutputDelta =
            streamEvent.type === "text_delta" ||
            streamEvent.type === "thinking_delta" ||
            streamEvent.type === "toolcall_delta";
        if (!isOutputDelta) return;

        streamStart ??= Date.now();
        estimatedStreamedTokens += Math.max(0, streamEvent.delta.length / 4);
    });

    pi.on("message_end", async (event) => {
        if (event.message.role !== "assistant") return;

        const outputTokens = event.message.usage.output;
        const timingStart = streamStart ?? messageStart;
        if (timingStart === undefined || outputTokens <= 0) {
            messageStart = undefined;
            streamStart = undefined;
            estimatedStreamedTokens = 0;
            return;
        }

        totalOutputTokens += outputTokens;
        totalStreamMs += Math.max(0, Date.now() - timingStart);

        messageStart = undefined;
        streamStart = undefined;
        estimatedStreamedTokens = 0;
    });

    pi.on("agent_end", async (_event, ctx) => {
        if (agentStartedAt === undefined) return;
        const duration = Date.now() - agentStartedAt;
        const elapsedSeconds = totalStreamMs / 1000;
        let tokensPerSecond: number | undefined;
        if (totalOutputTokens > 0 && elapsedSeconds > 0) {
            tokensPerSecond = Math.round(totalOutputTokens / elapsedSeconds);
        }
        agentStartedAt = undefined;
        setWorkedForWidget(ctx, formatDuration(duration), tokensPerSecond);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        agentStartedAt = undefined;
        messageStart = undefined;
        streamStart = undefined;
        estimatedStreamedTokens = 0;
        totalOutputTokens = 0;
        totalStreamMs = 0;
        ctx.ui.setFooter(undefined);
        setWorkedForWidget(ctx, undefined);
    });
}
