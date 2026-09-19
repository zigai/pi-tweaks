import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { getFooterSlotSnapshots, subscribeFooterSlotUpdates } from "./footer-slot-api.ts";
import {
    createGitAheadBehindTracker,
    formatGitAheadBehind,
    type GitAheadBehindSource,
} from "./git-ahead-behind.ts";
import { DEFAULT_FOOTER_CONFIG, type FooterConfig } from "./settings.ts";
import type { MouseInputEvent, MouseInputResult } from "./mouse-input.ts";
import type {
    ContextUsage,
    FooterContext,
    FooterData,
    FooterItem,
    FooterLayout,
    FooterSlotId,
    FooterSlotSnapshot,
    FooterSide,
    FooterVariant,
} from "./footer-model.ts";

const ACTIVE_FOOTER_VARIANT = "plain" as const;
const BRANCH_ICON = "";

export type PlainFooterTheme = {
    fg(role: "muted" | "dim", text: string): string;
};

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

function renderBlockItem(item: FooterItem): string {
    return ` ${item.text} `;
}

function renderThemeText(
    text: string,
    role: "muted" | "dim",
    theme: PlainFooterTheme | undefined,
): string {
    if (theme === undefined) return text;
    return theme.fg(role, text);
}

function renderPlainItem(item: FooterItem, theme: PlainFooterTheme | undefined): string {
    return renderThemeText(item.text, "muted", theme);
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
    if (serverCount !== undefined) {
        return `MCP: ${serverCount} servers`;
    }

    return null;
}

function getSeparator(
    variant: FooterVariant,
    side: FooterSide,
    config: FooterConfig,
    theme: PlainFooterTheme | undefined,
): string {
    if (variant === "blocks") return "";

    if (side === "left") {
        return renderThemeText(` ${config.separator} `, "dim", theme);
    }

    return renderThemeText("  ", "dim", theme);
}

function renderItem(
    item: FooterItem,
    variant: FooterVariant,
    theme: PlainFooterTheme | undefined,
): string {
    if (variant === "blocks") {
        return renderBlockItem(item);
    }

    return renderPlainItem(item, theme);
}

function joinRenderedItems(
    rendered: string[],
    variant: FooterVariant,
    side: FooterSide,
    config: FooterConfig,
    theme: PlainFooterTheme | undefined,
): string {
    return rendered.join(getSeparator(variant, side, config, theme));
}

type ItemRange = { start: number; end: number };

type RenderedSideVariant = {
    text: string;
    itemRanges: ReadonlyMap<FooterSlotId, ItemRange>;
};

function renderSideVariant(
    items: readonly FooterItem[],
    variant: FooterVariant,
    side: FooterSide,
    config: FooterConfig,
    theme: PlainFooterTheme | undefined,
): RenderedSideVariant {
    const separator = getSeparator(variant, side, config, theme);
    const separatorWidth = visibleWidth(separator);
    const rendered: string[] = [];
    const itemRanges = new Map<FooterSlotId, ItemRange>();
    let offset = 0;

    for (const item of items) {
        if (rendered.length > 0) offset += separatorWidth;

        const text = renderItem(item, variant, theme);
        const end = offset + visibleWidth(text);
        itemRanges.set(item.key, { start: offset, end });
        rendered.push(text);
        offset = end;
    }

    return {
        text: joinRenderedItems(rendered, variant, side, config, theme),
        itemRanges,
    };
}

function buildSideVariants(
    itemsByKey: ReadonlyMap<FooterSlotId, FooterItem>,
    keys: readonly FooterSlotId[],
    variant: FooterVariant,
    side: FooterSide,
    config: FooterConfig,
    theme: PlainFooterTheme | undefined,
): RenderedSideVariant[] {
    const items = keys
        .map((key) => itemsByKey.get(key))
        .filter((item): item is FooterItem => item !== undefined);
    if (items.length === 0) {
        return [{ text: "", itemRanges: new Map() }];
    }

    const variants: RenderedSideVariant[] = [];
    const seen = new Set<string>();

    if (side === "left") {
        for (let count = items.length; count >= 1; count--) {
            const rendered = renderSideVariant(items.slice(0, count), variant, side, config, theme);
            if (!seen.has(rendered.text)) {
                seen.add(rendered.text);
                variants.push(rendered);
            }
        }
    } else {
        for (let start = 0; start < items.length; start++) {
            const rendered = renderSideVariant(items.slice(start), variant, side, config, theme);
            if (!seen.has(rendered.text)) {
                seen.add(rendered.text);
                variants.push(rendered);
            }
        }

        variants.push({ text: "", itemRanges: new Map() });
    }

    return variants;
}

function renderPadding(
    width: number,
    variant: FooterVariant,
    theme: PlainFooterTheme | undefined,
): string {
    if (width <= 0) return "";

    const padding = " ".repeat(width);
    if (variant === "plain") {
        return renderThemeText(padding, "muted", theme);
    }

    return padding;
}

function buildFooterItems(
    ctx: FooterContext,
    footerData: FooterData,
    thinkingLevel: string,
    customSlots: readonly FooterSlotSnapshot[],
    gitAheadBehindSource: GitAheadBehindSource | undefined,
): Map<FooterSlotId, FooterItem> {
    const branch = footerData.getGitBranch();
    const pathText = collapseHome(ctx.cwd);
    const providerId = ctx.model?.provider ?? "no-provider";
    const providerLabel = getProviderDisplayName(ctx, providerId);
    const modelLabel = ctx.model?.name ?? ctx.model?.id ?? "no-model";
    const usage = ctx.getContextUsage();
    const contextText = getContextText(usage, ctx.model?.contextWindow);
    const mcpText = getMcpText(ctx, footerData);
    const items = new Map<FooterSlotId, FooterItem>();
    items.set("path", {
        key: "path",
        text: pathText,
        colors: { bg: "", fg: "" },
    });
    items.set("provider", {
        key: "provider",
        text: providerLabel,
        colors: { bg: "", fg: "" },
    });
    items.set("model", {
        key: "model",
        text: modelLabel,
        colors: { bg: "", fg: "" },
    });
    items.set("thinking", {
        key: "thinking",
        text: thinkingLevel,
        colors: { bg: "", fg: "" },
    });
    items.set("context", {
        key: "context",
        text: contextText,
        colors: { bg: "", fg: "" },
    });

    if (branch !== null && branch.length > 0) {
        const gitAheadBehind = gitAheadBehindSource?.getGitAheadBehind();
        let branchText = `${BRANCH_ICON} ${branch}`;
        if (gitAheadBehind !== undefined) {
            branchText += ` ${formatGitAheadBehind(gitAheadBehind)}`;
        }

        items.set("branch", {
            key: "branch",
            text: branchText,
            colors: { bg: "", fg: "" },
        });
    }

    if (mcpText !== null && mcpText.length > 0) {
        items.set("mcp", {
            key: "mcp",
            text: mcpText,
            colors: { bg: "", fg: "" },
        });
    }

    for (const slot of customSlots) {
        items.set(slot.id, {
            key: slot.id,
            text: slot.text,
            colors: slot.colors,
        });
    }

    return items;
}

function resolveFooterLayout(
    configLayout: FooterLayout,
    customSlots: readonly FooterSlotSnapshot[],
): Pick<FooterLayout, "left" | "right"> {
    const hiddenIds = new Set(configLayout.hidden);
    const left: FooterSlotId[] = [];
    const right: FooterSlotId[] = [];

    for (const slotId of configLayout.left) {
        if (!hiddenIds.has(slotId)) {
            left.push(slotId);
        }
    }

    for (const slotId of configLayout.right) {
        if (!hiddenIds.has(slotId)) {
            right.push(slotId);
        }
    }

    const configuredIds = new Set<FooterSlotId>([...hiddenIds, ...left, ...right]);
    for (const slot of customSlots) {
        if (slot.defaultSide === undefined) continue;
        if (configuredIds.has(slot.id)) continue;

        if (slot.defaultSide === "left") {
            left.push(slot.id);
        } else {
            right.push(slot.id);
        }

        configuredIds.add(slot.id);
    }

    return { left, right };
}

export type FooterClickAnchor = {
    screenX: number;
    screenY: number;
};

export type FooterInteractions = {
    onModelClick?: (anchor: FooterClickAnchor) => void;
    onThinkingClick?: (anchor: FooterClickAnchor) => void;
};

export function createFooterComponent(
    ctx: FooterContext,
    footerData: FooterData,
    getThinkingLevel: () => string,
    requestRender: () => void,
    config: FooterConfig = DEFAULT_FOOTER_CONFIG,
    theme?: PlainFooterTheme,
    gitAheadBehindSource?: GitAheadBehindSource,
    interactions: FooterInteractions = {},
) {
    let activeGitAheadBehindSource: GitAheadBehindSource | undefined;
    let modelHitRange: ItemRange | undefined;
    let thinkingHitRange: ItemRange | undefined;

    if (config.showGitAheadBehind) {
        activeGitAheadBehindSource = gitAheadBehindSource;
        activeGitAheadBehindSource ??= createGitAheadBehindTracker(ctx.cwd, requestRender);
    }

    const unsubscribeBranchChange = footerData.onBranchChange(() => {
        activeGitAheadBehindSource?.refresh();
        requestRender();
    });
    const unsubscribeSlotUpdates = subscribeFooterSlotUpdates(() => requestRender());

    return {
        dispose() {
            unsubscribeBranchChange();
            unsubscribeSlotUpdates();
            activeGitAheadBehindSource?.dispose();
        },
        handleMouse(event: MouseInputEvent): MouseInputResult | undefined {
            if (event.type !== "click" || event.button !== "left" || event.y !== 0) {
                return undefined;
            }

            if (
                modelHitRange !== undefined &&
                event.x >= modelHitRange.start &&
                event.x < modelHitRange.end &&
                interactions.onModelClick !== undefined
            ) {
                interactions.onModelClick({
                    screenX: event.screenX - (event.x - modelHitRange.start),
                    screenY: event.screenY,
                });
                return { handled: true, render: false };
            }

            if (thinkingHitRange === undefined || interactions.onThinkingClick === undefined) {
                return undefined;
            }

            if (event.x < thinkingHitRange.start || event.x >= thinkingHitRange.end)
                return undefined;

            interactions.onThinkingClick({
                screenX: event.screenX - (event.x - thinkingHitRange.start),
                screenY: event.screenY,
            });

            return { handled: true, render: false };
        },
        invalidate() {},
        render(width: number): string[] {
            modelHitRange = undefined;
            thinkingHitRange = undefined;

            // Keep spare terminal cells unused as a guard against ambiguous-width
            // glyphs (notably Nerd Font icons like the branch icon). A footer line
            // that reaches the exact terminal width can soft-wrap into an apparent
            // blank line and make the bottom chrome jump during heavy tool output.
            const renderWidth = Math.max(0, width - 2);
            if (renderWidth === 0) return [""];

            const variant: FooterVariant = ACTIVE_FOOTER_VARIANT;
            const customSlots = getFooterSlotSnapshots();
            const layout = resolveFooterLayout(config.layout, customSlots);
            const itemsByKey = buildFooterItems(
                ctx,
                footerData,
                getThinkingLevel(),
                customSlots,
                activeGitAheadBehindSource,
            );
            const leftVariants = buildSideVariants(
                itemsByKey,
                layout.left,
                variant,
                "left",
                config,
                theme,
            );
            const rightVariants = buildSideVariants(
                itemsByKey,
                layout.right,
                variant,
                "right",
                config,
                theme,
            );

            for (const left of leftVariants) {
                for (const right of rightVariants) {
                    const rightWidth = visibleWidth(right.text);
                    const leftWidth = visibleWidth(left.text);
                    const edgePaddingWidth = 2;
                    let minimumInnerGap = 0;
                    if (right.text.length > 0) {
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
                    const padding = renderPadding(paddingWidth, variant, theme);
                    const leftModelRange = left.itemRanges.get("model");
                    if (leftModelRange !== undefined) {
                        modelHitRange = {
                            start: 1 + leftModelRange.start,
                            end: 1 + leftModelRange.end,
                        };
                    }

                    const leftThinkingRange = left.itemRanges.get("thinking");
                    if (leftThinkingRange !== undefined) {
                        thinkingHitRange = {
                            start: 1 + leftThinkingRange.start,
                            end: 1 + leftThinkingRange.end,
                        };
                    }

                    if (right.text.length > 0) {
                        const rightStart = 1 + leftWidth + paddingWidth;
                        const rightModelRange = right.itemRanges.get("model");
                        if (rightModelRange !== undefined) {
                            modelHitRange = {
                                start: rightStart + rightModelRange.start,
                                end: rightStart + rightModelRange.end,
                            };
                        }

                        const rightThinkingRange = right.itemRanges.get("thinking");
                        if (rightThinkingRange !== undefined) {
                            thinkingHitRange = {
                                start: rightStart + rightThinkingRange.start,
                                end: rightStart + rightThinkingRange.end,
                            };
                        }

                        return [
                            truncateToWidth(
                                ` ${left.text}${padding}${right.text} `,
                                renderWidth,
                                "",
                            ),
                        ];
                    }

                    return [truncateToWidth(` ${left.text}${padding} `, renderWidth, "")];
                }
            }

            const fallbackRight = rightVariants.find((value) => value.text.length > 0);
            if (fallbackRight !== undefined) {
                modelHitRange = fallbackRight.itemRanges.get("model");
                thinkingHitRange = fallbackRight.itemRanges.get("thinking");
                return [truncateToWidth(fallbackRight.text, renderWidth, "")];
            }

            const fallbackLeft = leftVariants.find((value) => value.text.length > 0);
            if (fallbackLeft === undefined) return [""];

            modelHitRange = fallbackLeft.itemRanges.get("model");
            thinkingHitRange = fallbackLeft.itemRanges.get("thinking");
            return [truncateToWidth(fallbackLeft.text, renderWidth, "")];
        },
    };
}
