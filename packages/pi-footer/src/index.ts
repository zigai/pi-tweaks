import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { FooterClickAnchor } from "./footer-rendering.ts";
import {
    installLiveFooter,
    patchFooterReset,
    rememberFooterForTransition,
} from "./footer-transition.ts";
import { createModelPicker, MODEL_PICKER_WIDTH } from "./model-picker.ts";
import { DEFAULT_FOOTER_CONFIG, loadFooterSettings, type LoadedFooterConfig } from "./settings.ts";
import { installFooterShrinkPaddingPatch } from "./tui-footer-shrink-padding.ts";
import { createThinkingPicker, THINKING_PICKER_WIDTH } from "./thinking-picker.ts";

const reportedConfigErrors = new Set<string>();

function reportConfigErrors(ctx: ExtensionContext, loaded: LoadedFooterConfig): void {
    for (const error of loaded.errors) {
        if (reportedConfigErrors.has(error)) {
            continue;
        }

        reportedConfigErrors.add(error);
        ctx.ui.notify(`[pi-footer] ${error}`, "error");
    }
}

function loadAndReportFooterSettings(ctx: ExtensionContext): LoadedFooterConfig {
    const loaded = loadFooterSettings(ctx.cwd, ctx.isProjectTrusted());
    reportConfigErrors(ctx, loaded);
    return loaded;
}

async function showThinkingPicker(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    anchor: FooterClickAnchor,
): Promise<void> {
    const model = ctx.model;
    if (model === undefined) return;

    const levels = getSupportedThinkingLevels(model);
    if (levels.length === 0) return;

    const selected = await ctx.ui.custom<ThinkingLevel | undefined>(
        (tui, theme, _keybindings, done) =>
            createThinkingPicker({
                currentLevel: pi.getThinkingLevel(),
                levels,
                theme,
                requestRender: () => tui.requestRender(),
                onSelect: done,
                onCancel: () => done(undefined),
            }),
        {
            overlay: true,
            overlayOptions: {
                anchor: "bottom-left",
                width: THINKING_PICKER_WIDTH,
                offsetX: anchor.screenX,
                offsetY: -1,
                margin: 0,
            },
        },
    );

    if (selected !== undefined) pi.setThinkingLevel(selected);
}

async function showModelPicker(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    anchor: FooterClickAnchor,
): Promise<void> {
    const currentModel = ctx.model;
    if (currentModel === undefined) return;

    const models = ctx.modelRegistry
        .getAvailable()
        .filter((model) => model.provider === currentModel.provider);
    const activeModel =
        ctx.modelRegistry.find(currentModel.provider, currentModel.id) ?? models.at(0);
    if (activeModel === undefined) return;

    await ctx.ui.custom<Model<Api> | undefined>(
        (tui, theme, _keybindings, done) => {
            let switching = false;
            const switchModel = async (model: Model<Api>): Promise<void> => {
                if (switching) return;

                switching = true;

                try {
                    const changed = await pi.setModel(model);
                    if (changed) {
                        done(model);
                        return;
                    }

                    switching = false;
                    ctx.ui.notify(`[pi-footer] Could not switch to ${model.name}.`, "warning");
                } catch {
                    switching = false;
                    ctx.ui.notify(`[pi-footer] Could not switch to ${model.name}.`, "error");
                }
            };

            return createModelPicker({
                activeModel,
                models,
                theme,
                requestRender: () => tui.requestRender(),
                onSelect: (model) => {
                    void switchModel(model);
                },
                onCancel: () => done(undefined),
            });
        },
        {
            overlay: true,
            overlayOptions: {
                anchor: "bottom-left",
                width: MODEL_PICKER_WIDTH,
                offsetX: anchor.screenX,
                offsetY: -1,
                margin: 0,
            },
        },
    );
}

export default function uiEnhancements(pi: ExtensionAPI) {
    patchFooterReset();

    const shrinkPaddingHandle = installFooterShrinkPaddingPatch();
    const getThinkingLevel = () => pi.getThinkingLevel();
    let activeFooterConfig = DEFAULT_FOOTER_CONFIG;
    let footerPopupOpen = false;

    const runFooterPopup = (
        ctx: ExtensionContext,
        open: () => Promise<void>,
        failureMessage: string,
    ): void => {
        if (footerPopupOpen) return;

        footerPopupOpen = true;
        void open()
            .catch(() => {
                ctx.ui.notify(failureMessage, "error");
            })
            .finally(() => {
                footerPopupOpen = false;
            });
    };

    const installFooter = (ctx: ExtensionContext) => {
        const loaded = loadAndReportFooterSettings(ctx);
        activeFooterConfig = loaded.config;
        installLiveFooter(ctx, getThinkingLevel, activeFooterConfig, {
            onModelClick: (anchor) => {
                runFooterPopup(
                    ctx,
                    async () => showModelPicker(pi, ctx, anchor),
                    "[pi-footer] Could not open the model picker.",
                );
            },
            onThinkingClick: (anchor) => {
                runFooterPopup(
                    ctx,
                    async () => showThinkingPicker(pi, ctx, anchor),
                    "[pi-footer] Could not open the thinking-level picker.",
                );
            },
        });
    };

    pi.on("session_start", async (_event, ctx) => {
        footerPopupOpen = false;
        installFooter(ctx);
    });

    pi.on("session_shutdown", async (event, ctx) => {
        rememberFooterForTransition(ctx, event.reason, getThinkingLevel(), activeFooterConfig);
        shrinkPaddingHandle?.dispose();
    });
}
