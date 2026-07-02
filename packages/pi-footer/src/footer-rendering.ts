import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
    ACTIVE_FOOTER_VARIANT,
    BLOCK_COLORS,
    BRANCH_ICON,
    FOOTER_LAYOUT,
    PLAIN_COLORS,
    PLAIN_SEPARATOR_COLORS,
} from "./constants.ts";
import { DEFAULT_FOOTER_CONFIG, type FooterConfig } from "./settings.ts";
import type {
    ContextUsage,
    FooterContext,
    FooterData,
    FooterItem,
    FooterKey,
    FooterSide,
    FooterVariant,
    Rgb,
    SegmentColors,
} from "./types.ts";

function sanitizeStatusText(text: string): string {
    return text
        .replace(/[\r\n\t]/g, " ")
        .replace(/ +/g, " ")
        .trim();
}

function formatTokens(count: number): string {
    if (count < 1000) return count.toString();
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
}

function collapseHome(path: string): string {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home !== undefined && home.length > 0 && path.startsWith(home)) {
        return `~${path.slice(home.length)}`;
    }
    return path;
}

function hexToRgb(hex: string): Rgb {
    const value = hex.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
        throw new Error(`Invalid hex color: ${hex}`);
    }
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ];
}

function ansiColor(text: string, options: { fg?: string; bg?: string; bold?: boolean }): string {
    const codes: string[] = [];

    if (options.bold === true) codes.push("1");
    if (options.fg !== undefined && options.fg.length > 0) {
        const [r, g, b] = hexToRgb(options.fg);
        codes.push(`38;2;${r};${g};${b}`);
    }
    if (options.bg !== undefined && options.bg.length > 0) {
        const [r, g, b] = hexToRgb(options.bg);
        codes.push(`48;2;${r};${g};${b}`);
    }

    if (codes.length === 0) return text;
    return `\x1b[${codes.join(";")}m${text}\x1b[0m`;
}

function renderColoredText(text: string, colors: SegmentColors): string {
    return ansiColor(text, { fg: colors.fg, bg: colors.bg });
}

function renderBlockItem(item: FooterItem): string {
    return renderColoredText(` ${item.text} `, item.colors);
}

function renderPlainItem(item: FooterItem): string {
    return renderColoredText(item.text, PLAIN_COLORS);
}

function getFallbackProviderDisplayName(provider: string): string {
    switch (provider) {
        case "github-copilot":
            return "copilot";
        default:
            return provider;
    }
}

function getProviderDisplayName(ctx: FooterContext, provider: string): string {
    const snapshotDisplayName = ctx.model?.providerDisplayName;
    if (snapshotDisplayName !== undefined && snapshotDisplayName.length > 0) {
        return snapshotDisplayName;
    }

    try {
        const registryDisplayName = ctx.modelRegistry?.getProviderDisplayName(provider);
        if (registryDisplayName !== undefined && registryDisplayName.length > 0) {
            return registryDisplayName;
        }
    } catch {
        return getFallbackProviderDisplayName(provider);
    }

    return getFallbackProviderDisplayName(provider);
}

function getThinkingColors(level: string): SegmentColors {
    switch (level) {
        case "minimal":
            return { bg: "#4338ca", fg: "#ffffff" };
        case "low":
            return { bg: "#0369a1", fg: "#ffffff" };
        case "medium":
            return { bg: "#0891b2", fg: "#062b33" };
        case "high":
            return { bg: "#8b5cf6", fg: "#ffffff" };
        case "xhigh":
            return { bg: "#dc2626", fg: "#ffffff" };
        case "off":
        default:
            return { bg: "#374151", fg: "#e5e7eb" };
    }
}

function getContextColors(percent: number | null | undefined): SegmentColors {
    if (percent !== null && percent !== undefined) {
        if (percent > 90) return { bg: "#dc2626", fg: "#ffffff" };
        if (percent > 70) return { bg: "#f59e0b", fg: "#1f1300" };
    }
    return { bg: "#06b6d4", fg: "#062b33" };
}

function getContextText(usage: ContextUsage, fallbackWindow?: number): string {
    const contextWindow = usage?.contextWindow ?? fallbackWindow ?? 0;
    const contextPercent = usage?.percent;
    if (contextPercent === null || contextPercent === undefined) {
        return `?/${formatTokens(contextWindow)}`;
    }
    return `${contextPercent.toFixed(1)}%/${formatTokens(contextWindow)}`;
}

function getMcpText(ctx: FooterContext, footerData: FooterData): string | null {
    const statuses = Array.from(footerData.getExtensionStatuses().values())
        .map(sanitizeStatusText)
        .filter((status) => status.length > 0);

    const mcpStatus = statuses.find((status) => /^MCP:/i.test(status));
    if (mcpStatus !== undefined && mcpStatus.length > 0) return mcpStatus;

    const serverCount = ctx.mcpServers?.length;
    if (typeof serverCount === "number") {
        return `MCP: ${serverCount} servers`;
    }

    return null;
}

function getSeparator(variant: FooterVariant, side: FooterSide, config: FooterConfig): string {
    if (variant === "blocks") return "";
    if (side === "left") {
        return renderColoredText(` ${config.separator} `, PLAIN_SEPARATOR_COLORS);
    }
    return renderColoredText("  ", PLAIN_SEPARATOR_COLORS);
}

function renderItem(item: FooterItem, variant: FooterVariant): string {
    if (variant === "blocks") {
        return renderBlockItem(item);
    }
    return renderPlainItem(item);
}

function joinRenderedItems(
    rendered: string[],
    variant: FooterVariant,
    side: FooterSide,
    config: FooterConfig,
): string {
    return rendered.join(getSeparator(variant, side, config));
}

function buildSideVariants(
    itemsByKey: Partial<Record<FooterKey, FooterItem>>,
    keys: readonly FooterKey[],
    variant: FooterVariant,
    side: FooterSide,
    config: FooterConfig,
): string[] {
    const items = keys
        .map((key) => itemsByKey[key])
        .filter((item): item is FooterItem => item !== undefined);
    if (items.length === 0) {
        return [""];
    }

    const variants: string[] = [];
    const seen = new Set<string>();

    if (side === "left") {
        for (let count = items.length; count >= 1; count--) {
            const rendered = joinRenderedItems(
                items.slice(0, count).map((item) => renderItem(item, variant)),
                variant,
                side,
                config,
            );
            if (!seen.has(rendered)) {
                seen.add(rendered);
                variants.push(rendered);
            }
        }
    } else {
        for (let start = 0; start < items.length; start++) {
            const rendered = joinRenderedItems(
                items.slice(start).map((item) => renderItem(item, variant)),
                variant,
                side,
                config,
            );
            if (!seen.has(rendered)) {
                seen.add(rendered);
                variants.push(rendered);
            }
        }
        variants.push("");
    }

    return variants;
}

function renderPadding(width: number, variant: FooterVariant): string {
    if (width <= 0) return "";
    const padding = " ".repeat(width);
    if (variant === "plain") {
        return renderColoredText(padding, PLAIN_COLORS);
    }
    return padding;
}

function buildFooterItems(
    ctx: FooterContext,
    footerData: FooterData,
    thinkingLevel: string,
): Partial<Record<FooterKey, FooterItem>> {
    const branch = footerData.getGitBranch();
    const pathText = collapseHome(ctx.cwd);
    const providerId = ctx.model?.provider ?? "no-provider";
    const providerLabel = getProviderDisplayName(ctx, providerId);
    const modelLabel = ctx.model?.name ?? ctx.model?.id ?? "no-model";
    const usage = ctx.getContextUsage();
    const contextText = getContextText(usage, ctx.model?.contextWindow);
    const mcpText = getMcpText(ctx, footerData);

    const items: Partial<Record<FooterKey, FooterItem>> = {
        path: {
            key: "path",
            text: pathText,
            colors: BLOCK_COLORS.path,
        },
        provider: {
            key: "provider",
            text: providerLabel,
            colors: BLOCK_COLORS.provider,
        },
        model: {
            key: "model",
            text: modelLabel,
            colors: BLOCK_COLORS.model,
        },
        thinking: {
            key: "thinking",
            text: thinkingLevel,
            colors: getThinkingColors(thinkingLevel),
        },
        context: {
            key: "context",
            text: contextText,
            colors: getContextColors(usage?.percent),
        },
    };

    if (branch !== null && branch.length > 0) {
        items.branch = {
            key: "branch",
            text: `${BRANCH_ICON} ${branch}`,
            colors: BLOCK_COLORS.branch,
        };
    }

    if (mcpText !== null && mcpText.length > 0) {
        items.mcp = {
            key: "mcp",
            text: mcpText,
            colors: BLOCK_COLORS.mcp,
        };
    }

    return items;
}

export function createFooterComponent(
    ctx: FooterContext,
    footerData: FooterData,
    getThinkingLevel: () => string,
    requestRender: () => void,
    config: FooterConfig = DEFAULT_FOOTER_CONFIG,
) {
    const unsubscribe = footerData.onBranchChange(() => requestRender());

    return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
            // Keep spare terminal cells unused as a guard against ambiguous-width
            // glyphs (notably Nerd Font icons like the branch icon). A footer line
            // that reaches the exact terminal width can soft-wrap into an apparent
            // blank line and make the bottom chrome jump during heavy tool output.
            const renderWidth = Math.max(0, width - 2);
            if (renderWidth === 0) return [""];
            const variant: FooterVariant = ACTIVE_FOOTER_VARIANT;
            const itemsByKey = buildFooterItems(ctx, footerData, getThinkingLevel());
            const leftVariants = buildSideVariants(
                itemsByKey,
                FOOTER_LAYOUT.left,
                variant,
                "left",
                config,
            );
            const rightVariants = buildSideVariants(
                itemsByKey,
                FOOTER_LAYOUT.right,
                variant,
                "right",
                config,
            );

            for (const left of leftVariants) {
                for (const right of rightVariants) {
                    const rightWidth = visibleWidth(right);
                    const leftWidth = visibleWidth(left);
                    const edgePaddingWidth = 2;
                    let minimumInnerGap = 0;
                    if (right.length > 0) {
                        minimumInnerGap = 1;
                    }
                    const requiredWidth =
                        edgePaddingWidth + leftWidth + minimumInnerGap + rightWidth;

                    if (requiredWidth > renderWidth) {
                        continue;
                    }

                    const paddingWidth = Math.max(
                        minimumInnerGap,
                        renderWidth - edgePaddingWidth - leftWidth - rightWidth,
                    );
                    const padding = renderPadding(paddingWidth, variant);
                    if (right.length > 0) {
                        return [truncateToWidth(` ${left}${padding}${right} `, renderWidth, "")];
                    }
                    return [truncateToWidth(` ${left}${padding} `, renderWidth, "")];
                }
            }

            const fallbackRight = rightVariants.find((value) => value.length > 0) ?? "";
            if (fallbackRight.length > 0) {
                return [truncateToWidth(fallbackRight, renderWidth, "")];
            }

            const fallbackLeft = leftVariants.find((value) => value.length > 0) ?? "";
            return [truncateToWidth(fallbackLeft, renderWidth, "")];
        },
    };
}
