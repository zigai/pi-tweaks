import {
    ModelRuntime,
    ModelSelectorComponent,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

import type { ModeController } from "./mode-controller.ts";
import {
    CUSTOM_MODE_NAME,
    isDefaultModeName,
    getModeThinkingLevels,
    isThinkingLevel,
    MODE_UI_ADD,
    MODE_UI_BACK,
    MODE_UI_CONFIGURE,
    MODE_UI_DEFAULT_MODEL,
    MODE_UI_THINKING_COLORS_OFF,
    MODE_UI_THINKING_COLORS_ON,
    MODE_UI_THINKING_STATUS_OFF,
    MODE_UI_THINKING_STATUS_ON,
    modeSpec,
    normalizeModeNameInput,
    orderedModeNames,
    THINKING_UNSET_LABEL,
    validateModeNameOrError,
    type DefaultModelSpec,
    type ModeSpec,
} from "./modes.ts";
import {
    setShowThinkingLevelStatus,
    setUseThinkingBorderColors,
    shouldShowThinkingLevelStatus,
    shouldUseThinkingBorderColors,
} from "./settings.ts";

const MODE_SELECTOR_SHORTCUTS = ["ctrl+shift+m"] as const;
type ShortcutRegistrar = Pick<ExtensionAPI, "registerShortcut">;
type ShortcutHandler = Parameters<ExtensionAPI["registerShortcut"]>[1]["handler"];

export function registerModeSelectorShortcuts(
    pi: ShortcutRegistrar,
    handler: ShortcutHandler,
): void {
    for (const shortcut of MODE_SELECTOR_SHORTCUTS) {
        pi.registerShortcut(shortcut, {
            description: "Select prompt mode",
            handler,
        });
    }
}
function readModelRuntime(registry: ExtensionContext["modelRegistry"]): ModelRuntime | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(registry, "runtime");
    const candidate: unknown = descriptor?.value;
    if (candidate instanceof ModelRuntime) return candidate;
    return undefined;
}

function errorMessage(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    return String(cause);
}

export class ModePicker {
    constructor(private readonly controller: ModeController) {}

    async select(ctx: ExtensionContext): Promise<void> {
        if (!ctx.hasUI) return;
        while (true) {
            await this.controller.ensure(ctx);
            const names = orderedModeNames(this.controller.modes.modes);
            const choice = await ctx.ui.select(`Mode (current: ${this.controller.currentMode})`, [
                ...names,
                MODE_UI_CONFIGURE,
            ]);
            if (choice === undefined || choice.length === 0) return;
            if (choice === MODE_UI_CONFIGURE) {
                await this.configure(ctx);
                continue;
            }
            await this.handleChoice(ctx, choice);
            return;
        }
    }

    async handleCommand(ctx: ExtensionContext, args: string): Promise<void> {
        const tokens = args
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (tokens.length === 0) {
            await this.select(ctx);
            return;
        }
        if (tokens[0] === "store") {
            await this.controller.ensure(ctx);
            let target: string | undefined = tokens[1];
            if (target === undefined || target.length === 0) {
                if (!ctx.hasUI) return;
                target = await ctx.ui.select(
                    "Store current selection into mode",
                    orderedModeNames(this.controller.modes.modes),
                );
                if (target === undefined || target.length === 0) return;
            }
            if (target === CUSTOM_MODE_NAME) {
                if (ctx.hasUI) ctx.ui.notify(`Cannot store into "${CUSTOM_MODE_NAME}"`, "warning");
                return;
            }
            await this.controller.storeSelection(
                ctx,
                target,
                this.controller.getOverlaySelection(),
            );
            if (ctx.hasUI) ctx.ui.notify(`Stored current selection into "${target}"`, "info");
            return;
        }
        await this.controller.applyMode(ctx, tokens[0] ?? "");
    }

    private async handleChoice(ctx: ExtensionContext, choice: string): Promise<void> {
        if (this.controller.currentMode === CUSTOM_MODE_NAME && choice !== CUSTOM_MODE_NAME) {
            const action = await ctx.ui.select(`Mode "${choice}"`, ["use", "store"]);
            if (action === undefined || action.length === 0) return;
            if (action === "store") {
                await this.controller.storeSelection(
                    ctx,
                    choice,
                    this.controller.getOverlaySelection(),
                );
                await this.controller.applyMode(ctx, choice);
                ctx.ui.notify(`Stored ${CUSTOM_MODE_NAME} into "${choice}"`, "info");
                return;
            }
        }
        await this.controller.applyMode(ctx, choice);
    }

    private async configure(ctx: ExtensionContext): Promise<void> {
        while (true) {
            await this.controller.ensure(ctx);
            const settingsContext = this.controller.getSettingsContext(ctx);
            const colorsEnabled = this.controller.thinkingBorderColorsEnabled;
            const statusEnabled = this.controller.thinkingLevelStatusEnabled;
            let thinkingColorsChoice = MODE_UI_THINKING_COLORS_OFF;
            if (colorsEnabled) thinkingColorsChoice = MODE_UI_THINKING_COLORS_ON;
            let thinkingStatusChoice = MODE_UI_THINKING_STATUS_OFF;
            if (statusEnabled) thinkingStatusChoice = MODE_UI_THINKING_STATUS_ON;
            const choice = await ctx.ui.select("Configure modes", [
                ...orderedModeNames(this.controller.modes.modes),
                MODE_UI_ADD,
                MODE_UI_DEFAULT_MODEL,
                thinkingColorsChoice,
                thinkingStatusChoice,
                MODE_UI_BACK,
            ]);
            if (choice === undefined || choice.length === 0 || choice === MODE_UI_BACK) return;
            if (choice === MODE_UI_ADD) {
                const created = await this.add(ctx);
                if (created !== undefined) await this.edit(ctx, created);
                continue;
            }
            if (choice === MODE_UI_DEFAULT_MODEL) {
                await this.setDefaultModel(ctx);
                continue;
            }
            if (choice === MODE_UI_THINKING_COLORS_ON || choice === MODE_UI_THINKING_COLORS_OFF) {
                const next = !colorsEnabled;
                try {
                    setUseThinkingBorderColors(settingsContext, next);
                } catch (cause: unknown) {
                    ctx.ui.notify(
                        `Thinking border colors were not saved: ${errorMessage(cause)}`,
                        "error",
                    );
                    continue;
                }
                this.controller.setUseThinkingBorderColors(
                    shouldUseThinkingBorderColors(settingsContext),
                );
                this.controller.requestRender();
                let stateLabel = "disabled";
                if (next) stateLabel = "enabled";
                ctx.ui.notify(`Thinking border colors ${stateLabel}`, "info");
                continue;
            }
            if (choice === MODE_UI_THINKING_STATUS_ON || choice === MODE_UI_THINKING_STATUS_OFF) {
                const next = !statusEnabled;
                try {
                    setShowThinkingLevelStatus(settingsContext, next);
                } catch (cause: unknown) {
                    ctx.ui.notify(
                        `Thinking level status was not saved: ${errorMessage(cause)}`,
                        "error",
                    );
                    continue;
                }
                this.controller.setShowThinkingLevelStatus(
                    shouldShowThinkingLevelStatus(settingsContext),
                );
                let stateLabel = "disabled";
                if (next) stateLabel = "enabled";
                ctx.ui.notify(`Thinking level status ${stateLabel}`, "info");
                continue;
            }
            await this.edit(ctx, choice);
        }
    }

    private async setDefaultModel(ctx: ExtensionContext): Promise<void> {
        const currentDefault = this.controller.modes.defaultModel;
        const currentSpec: ModeSpec = currentDefault ?? {
            provider: ctx.model?.provider,
            modelId: ctx.model?.id,
            thinkingLevel: this.controller.getCurrentSelection().thinkingLevel,
        };
        const selectedModel = await this.pickModel(ctx, currentSpec);
        if (selectedModel === undefined) return;
        const model =
            ctx.modelRegistry.find(selectedModel.provider, selectedModel.modelId) ?? ctx.model;
        const thinkingLevel = await this.pickThinkingLevel(
            ctx,
            currentDefault?.thinkingLevel ?? this.controller.getCurrentSelection().thinkingLevel,
            model,
        );
        if (thinkingLevel === undefined) return;
        const defaultModel: DefaultModelSpec = selectedModel;
        if (thinkingLevel !== null) defaultModel.thinkingLevel = thinkingLevel;
        await this.controller.setDefaultModel(ctx, defaultModel);
        ctx.ui.notify(
            `Default model set to ${defaultModel.provider}/${defaultModel.modelId}`,
            "info",
        );
    }

    private async add(ctx: ExtensionContext): Promise<string | undefined> {
        await this.controller.ensure(ctx);
        while (true) {
            const raw = await ctx.ui.input("New mode name", "e.g. docs, review, planning");
            if (raw === undefined) return undefined;
            const name = normalizeModeNameInput(raw);
            const error = validateModeNameOrError(name, this.controller.modes.modes);
            if (error !== null) {
                ctx.ui.notify(error, "warning");
                continue;
            }
            await this.controller.addMode(ctx, name);
            ctx.ui.notify(`Added mode "${name}"`, "info");
            return name;
        }
    }

    private async rename(ctx: ExtensionContext, oldName: string): Promise<string | undefined> {
        if (isDefaultModeName(oldName)) {
            ctx.ui.notify(`Cannot rename default mode "${oldName}"`, "warning");
            return oldName;
        }
        await this.controller.ensure(ctx);
        while (true) {
            const raw = await ctx.ui.input(`Rename mode "${oldName}"`, oldName);
            if (raw === undefined) return undefined;
            const newName = normalizeModeNameInput(raw);
            if (newName.length === 0 || newName === oldName) return oldName;
            const error = validateModeNameOrError(newName, this.controller.modes.modes);
            if (error !== null) {
                ctx.ui.notify(error, "warning");
                continue;
            }
            await this.controller.renameMode(ctx, oldName, newName);
            ctx.ui.notify(`Renamed "${oldName}" → "${newName}"`, "info");
            return newName;
        }
    }

    private async edit(ctx: ExtensionContext, initialName: string): Promise<void> {
        let name = initialName;
        while (true) {
            await this.controller.ensure(ctx);
            const spec = modeSpec(this.controller.modes.modes, name);
            if (spec === undefined) return;
            let modelLabel = "(no model)";
            if (spec.provider !== undefined && spec.modelId !== undefined) {
                modelLabel = `${spec.provider}/${spec.modelId}`;
            }
            const actions = ["Change name", "Change model", "Change thinking level"];
            if (!isDefaultModeName(name)) actions.push("Delete mode");
            actions.push(MODE_UI_BACK);
            const action = await ctx.ui.select(
                `Edit mode "${name}"  model: ${modelLabel}  thinking: ${spec.thinkingLevel ?? THINKING_UNSET_LABEL}`,
                actions,
            );
            if (action === undefined || action.length === 0 || action === MODE_UI_BACK) return;
            if (action === "Change name") {
                const renamed = await this.rename(ctx, name);
                if (renamed !== undefined) name = renamed;
                continue;
            }
            if (action === "Change model") {
                const selected = await this.pickModel(ctx, spec);
                if (selected === undefined) continue;
                await this.controller.updateMode(ctx, name, { ...spec, ...selected });
                ctx.ui.notify(`Updated model for "${name}"`, "info");
                if (this.controller.currentMode === name)
                    await this.controller.applyMode(ctx, name);
                continue;
            }
            if (action === "Change thinking level") {
                let model = ctx.model;
                if (spec.provider !== undefined && spec.modelId !== undefined) {
                    model = ctx.modelRegistry.find(spec.provider, spec.modelId) ?? ctx.model;
                }
                const level = await this.pickThinkingLevel(ctx, spec.thinkingLevel, model);
                if (level === undefined) continue;
                const next = { ...spec };
                if (level === null) delete next.thinkingLevel;
                else next.thinkingLevel = level;
                await this.controller.updateMode(ctx, name, next);
                ctx.ui.notify(`Updated thinking level for "${name}"`, "info");
                if (this.controller.currentMode === name)
                    await this.controller.applyMode(ctx, name);
                continue;
            }
            if (action === "Delete mode") {
                if (!(await ctx.ui.confirm("Delete mode", `Delete mode "${name}"?`))) continue;
                await this.controller.deleteMode(ctx, name);
                ctx.ui.notify(`Deleted mode "${name}"`, "info");
                return;
            }
        }
    }

    private async pickThinkingLevel(
        ctx: ExtensionContext,
        current: ThinkingLevel | undefined,
        model: Model<Api> | undefined,
    ): Promise<ThinkingLevel | null | undefined> {
        const supported = getModeThinkingLevels(model);
        let initial: ThinkingLevel = supported[0] ?? "off";
        if (current !== undefined && supported.includes(current)) {
            initial = current;
        }
        const options = [...supported, THINKING_UNSET_LABEL];
        const choice = await ctx.ui.select("Thinking level", [
            initial,
            ...options.filter((value) => value !== initial),
        ]);
        if (choice === undefined || choice.length === 0) return undefined;
        if (choice === THINKING_UNSET_LABEL) return null;
        if (isThinkingLevel(choice)) return choice;
        return undefined;
    }

    private async pickModel(
        ctx: ExtensionContext,
        spec: ModeSpec,
    ): Promise<{ provider: string; modelId: string } | undefined> {
        const runtime = readModelRuntime(ctx.modelRegistry);
        if (runtime === undefined) {
            ctx.ui.notify("Model picker unavailable: Pi model runtime was not found.", "error");
            return undefined;
        }
        let current = ctx.model;
        if (spec.provider !== undefined && spec.modelId !== undefined) {
            current = ctx.modelRegistry.find(spec.provider, spec.modelId) ?? ctx.model;
        }
        return ctx.ui.custom(
            (tui, _theme, _keybindings, done) =>
                new ModelSelectorComponent(
                    tui,
                    current,
                    runtime,
                    [],
                    (model) => {
                        if (model.id === undefined) {
                            done(undefined);
                            return;
                        }
                        done({ provider: model.provider, modelId: model.id });
                    },
                    () => done(undefined),
                ),
        );
    }
}
