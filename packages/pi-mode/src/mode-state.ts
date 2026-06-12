import {
    ModelSelectorComponent,
    SettingsManager,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import fs from "node:fs/promises";
import {
    ALL_THINKING_LEVELS,
    CUSTOM_MODE_NAME,
    DEFAULT_MODE_ORDER,
    MODE_UI_ADD,
    MODE_UI_BACK,
    MODE_UI_CONFIGURE,
    MODE_UI_SHOW_NAME_OFF,
    MODE_UI_SHOW_NAME_ON,
    THINKING_UNSET_LABEL,
} from "./constants.ts";
import {
    atomicWriteUtf8,
    fileExists,
    getGlobalModesPath,
    getMtimeMs,
    getProjectModesPath,
    withFileLock,
} from "./storage.ts";
import { setShowModeName, shouldShowModeName } from "./settings.ts";
import type { ModeRuntime, ModesFile, ModesPatch, ModeSpec, ModeSpecPatch } from "./types.ts";

type ScopedModelItem = {
    model: Model<Api>;
    thinkingLevel?: string;
};

type ModeSpecJson = {
    provider?: string;
    modelId?: string;
    thinkingLevel?: ThinkingLevel;
    color?: ModeSpec["color"];
};

type ModesFileJson = {
    currentMode?: string;
    modes?: Record<string, ModeSpecJson>;
};

function cloneModesFile(file: ModesFile): ModesFile {
    return JSON.parse(JSON.stringify(file)) as ModesFile;
}

function modeSpec(modes: Record<string, ModeSpec>, name: string): ModeSpec | undefined {
    if (Object.hasOwn(modes, name)) return modes[name];
    return undefined;
}

function computeModesPatch(
    base: ModesFile,
    next: ModesFile,
    includeCurrentMode: boolean,
): ModesPatch | null {
    const patch: ModesPatch = {};

    if (includeCurrentMode && base.currentMode !== next.currentMode) {
        patch.currentMode = next.currentMode;
    }

    const keys = new Set([...Object.keys(base.modes), ...Object.keys(next.modes)]);
    const modesPatch: Record<string, ModeSpecPatch | null> = {};

    for (const key of keys) {
        const before = base.modes[key];
        const after = next.modes[key];

        if (after === undefined) {
            if (before !== undefined) modesPatch[key] = null;
            continue;
        }
        if (before === undefined) {
            modesPatch[key] = { ...after };
            continue;
        }

        const diff: ModeSpecPatch = {};
        if (before.provider !== after.provider) {
            diff.provider = after.provider ?? null;
        }
        if (before.modelId !== after.modelId) {
            diff.modelId = after.modelId ?? null;
        }
        if (before.thinkingLevel !== after.thinkingLevel) {
            diff.thinkingLevel = after.thinkingLevel ?? null;
        }
        if (before.color !== after.color) {
            diff.color = after.color ?? null;
        }
        if (Object.keys(diff).length > 0) {
            modesPatch[key] = diff;
        }
    }

    if (Object.keys(modesPatch).length > 0) {
        patch.modes = modesPatch;
    }

    if (patch.modes === undefined && patch.currentMode === undefined) return null;
    return patch;
}

function applyModesPatch(target: ModesFile, patch: ModesPatch): void {
    if (patch.currentMode !== undefined) {
        target.currentMode = patch.currentMode;
    }

    if (patch.modes === undefined) return;
    for (const [mode, specPatch] of Object.entries(patch.modes)) {
        if (specPatch === null) {
            delete target.modes[mode];
            continue;
        }

        const targetSpec = modeSpec(target.modes, mode) ?? {};
        target.modes[mode] = targetSpec;
        if ("provider" in specPatch) {
            if (specPatch.provider === null || specPatch.provider === undefined) {
                delete targetSpec.provider;
            } else {
                targetSpec.provider = specPatch.provider;
            }
        }
        if ("modelId" in specPatch) {
            if (specPatch.modelId === null || specPatch.modelId === undefined) {
                delete targetSpec.modelId;
            } else {
                targetSpec.modelId = specPatch.modelId;
            }
        }
        if ("thinkingLevel" in specPatch) {
            if (specPatch.thinkingLevel === null || specPatch.thinkingLevel === undefined) {
                delete targetSpec.thinkingLevel;
            } else {
                targetSpec.thinkingLevel = specPatch.thinkingLevel;
            }
        }
        if ("color" in specPatch) {
            if (specPatch.color === null || specPatch.color === undefined) {
                delete targetSpec.color;
            } else {
                targetSpec.color = specPatch.color;
            }
        }
    }
}

function normalizeThinkingLevel(level: ThinkingLevel | undefined): ThinkingLevel | undefined {
    if (level === undefined) return undefined;
    if (ALL_THINKING_LEVELS.includes(level)) {
        return level;
    }
    return undefined;
}

function getLoadErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string") return code;
    return undefined;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function throwLoadError(filePath: string, error: unknown): never {
    throw new Error(`Failed to load ${filePath}: ${errorMessage(error)}`);
}

function sanitizeModeSpec(spec: ModeSpecJson | undefined): ModeSpec {
    if (spec === undefined) return {};

    const sanitized: ModeSpec = {
        thinkingLevel: normalizeThinkingLevel(spec.thinkingLevel),
    };
    if (spec.provider !== undefined) sanitized.provider = spec.provider;
    if (spec.modelId !== undefined) sanitized.modelId = spec.modelId;
    if (spec.color !== undefined) sanitized.color = spec.color;
    return sanitized;
}

function createDefaultModes(ctx: ExtensionContext, pi: ExtensionAPI): ModesFile {
    const currentModel = ctx.model;
    const currentThinking = pi.getThinkingLevel();

    const base: ModeSpec = {
        provider: currentModel?.provider,
        modelId: currentModel?.id,
        thinkingLevel: currentThinking,
    };

    return {
        version: 1,
        currentMode: "default",
        modes: {
            default: { ...base },
            fast: { ...base, thinkingLevel: "off" },
        },
    };
}

function ensureDefaultModeEntries(file: ModesFile, ctx: ExtensionContext, pi: ExtensionAPI): void {
    for (const name of DEFAULT_MODE_ORDER) {
        if (modeSpec(file.modes, name) === undefined) {
            const defaults = createDefaultModes(ctx, pi);
            file.modes[name] = defaults.modes[name]!;
        }
    }

    if (file.currentMode === CUSTOM_MODE_NAME) {
        file.currentMode = "";
    }

    if (
        file.currentMode.length === 0 ||
        !(file.currentMode in file.modes) ||
        file.currentMode === CUSTOM_MODE_NAME
    ) {
        const first = Object.keys(file.modes).find((name) => name !== CUSTOM_MODE_NAME);
        if (modeSpec(file.modes, "default") !== undefined) {
            file.currentMode = "default";
        } else if (first !== undefined && first.length > 0) {
            file.currentMode = first;
        } else {
            file.currentMode = "default";
        }
    }
}

async function loadModesFile(
    filePath: string,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
    options?: { throwOnInvalid?: boolean },
): Promise<ModesFile> {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as ModesFileJson;
        const currentMode = parsed.currentMode ?? "default";
        const modesRaw = parsed.modes ?? {};

        const modes: Record<string, ModeSpec> = {};
        for (const [key, value] of Object.entries(modesRaw)) {
            modes[key] = sanitizeModeSpec(value);
        }

        const file: ModesFile = {
            version: 1,
            currentMode,
            modes,
        };
        ensureDefaultModeEntries(file, ctx, pi);
        return file;
    } catch (error: unknown) {
        if (getLoadErrorCode(error) === "ENOENT") return createDefaultModes(ctx, pi);
        if (options?.throwOnInvalid === true) throwLoadError(filePath, error);
        return createDefaultModes(ctx, pi);
    }
}

async function saveModesFile(filePath: string, data: ModesFile): Promise<void> {
    await atomicWriteUtf8(filePath, JSON.stringify(data, null, 2) + "\n");
}

function orderedModeNames(modes: Record<string, ModeSpec>): string[] {
    return Object.keys(modes).filter((name) => name !== CUSTOM_MODE_NAME);
}

function formatModeLabel(mode: string): string {
    return mode;
}

async function resolveModesPath(cwd: string): Promise<string> {
    const projectPath = getProjectModesPath(cwd);
    if (await fileExists(projectPath)) return projectPath;
    return getGlobalModesPath();
}

function inferModeFromSelection(
    ctx: ExtensionContext,
    pi: ExtensionAPI,
    data: ModesFile,
): string | null {
    const provider = ctx.model?.provider;
    const modelId = ctx.model?.id;
    const thinkingLevel = pi.getThinkingLevel();
    if (
        provider === undefined ||
        provider.length === 0 ||
        modelId === undefined ||
        modelId.length === 0
    ) {
        return null;
    }

    const names = orderedModeNames(data.modes);
    const supportsThinking = ctx.model?.reasoning === true;

    if (supportsThinking) {
        for (const name of names) {
            const spec = modeSpec(data.modes, name);
            if (spec === undefined) continue;
            if (spec.provider !== provider || spec.modelId !== modelId) continue;
            if ((spec.thinkingLevel ?? undefined) !== thinkingLevel) continue;
            return name;
        }
        return null;
    }

    const candidates: string[] = [];
    for (const name of names) {
        const spec = modeSpec(data.modes, name);
        if (spec === undefined) continue;
        if (spec.provider !== provider || spec.modelId !== modelId) continue;
        candidates.push(name);
    }
    if (candidates.length === 0) return null;

    for (const name of candidates) {
        const spec = modeSpec(data.modes, name);
        if (spec === undefined) continue;
        if ((spec.thinkingLevel ?? "off") === thinkingLevel) return name;
    }

    for (const name of candidates) {
        const spec = modeSpec(data.modes, name);
        if (spec === undefined) continue;
        if (spec.thinkingLevel === undefined) return name;
    }

    return candidates[0] ?? null;
}

const runtime: ModeRuntime = {
    filePath: "",
    fileMtimeMs: null,
    baseline: null,
    data: { version: 1, currentMode: "default", modes: {} },
    lastRealMode: "default",
    currentMode: "default",
    applying: false,
};

let requestEditorRender: (() => void) | undefined;
let customOverlay: ModeSpec | null = null;
let lastObservedModel: { provider?: string; modelId?: string } = {};

export function setRequestEditorRender(requestRender?: () => void): void {
    requestEditorRender = requestRender;
}

export function getCurrentMode(): string {
    return formatModeLabel(runtime.currentMode);
}

export function getModeBorderColor(
    ctx: ExtensionContext,
    pi: ExtensionAPI,
    mode: string,
): (text: string) => string {
    const theme = ctx.ui.theme;
    const spec = runtime.data.modes[mode];

    if (spec?.color !== undefined && spec.color.length > 0) {
        const color = spec.color;
        try {
            theme.getFgAnsi(color);
            return (text: string) => theme.fg(color, text);
        } catch {
            // fall back to thinking-derived colors
        }
    }

    return theme.getThinkingBorderColor(pi.getThinkingLevel());
}

async function ensureRuntime(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    const filePath = await resolveModesPath(ctx.cwd);

    const mtimeMs = await getMtimeMs(filePath);
    const filePathChanged = runtime.filePath !== filePath;
    const fileChanged = filePathChanged || runtime.fileMtimeMs !== mtimeMs;

    if (fileChanged) {
        runtime.filePath = filePath;
        runtime.fileMtimeMs = mtimeMs;

        const loaded = await loadModesFile(filePath, ctx, pi);
        ensureDefaultModeEntries(loaded, ctx, pi);
        runtime.data = loaded;
        runtime.baseline = cloneModesFile(runtime.data);

        if (filePathChanged && runtime.currentMode !== CUSTOM_MODE_NAME) {
            runtime.currentMode = runtime.data.currentMode;
            runtime.lastRealMode = runtime.currentMode;
        }
    }

    if (runtime.currentMode !== CUSTOM_MODE_NAME) {
        if (runtime.currentMode.length === 0 || !(runtime.currentMode in runtime.data.modes)) {
            runtime.currentMode = runtime.data.currentMode;
        }
        if (runtime.lastRealMode.length === 0 || !(runtime.lastRealMode in runtime.data.modes)) {
            runtime.lastRealMode = runtime.currentMode;
        }
    }
}

async function persistRuntime(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    if (runtime.filePath.length === 0) return;

    runtime.baseline ??= cloneModesFile(runtime.data);
    const patch = computeModesPatch(runtime.baseline, runtime.data, false);
    if (patch === null) return;

    try {
        await withFileLock(runtime.filePath, async () => {
            const latest = await loadModesFile(runtime.filePath, ctx, pi, { throwOnInvalid: true });
            applyModesPatch(latest, patch);
            ensureDefaultModeEntries(latest, ctx, pi);
            await saveModesFile(runtime.filePath, latest);

            runtime.data = latest;
            runtime.baseline = cloneModesFile(latest);
            runtime.fileMtimeMs = await getMtimeMs(runtime.filePath);
        });
    } catch (error: unknown) {
        if (ctx.hasUI) {
            ctx.ui.notify(`Mode settings were not saved: ${errorMessage(error)}`, "error");
        }
        throw error;
    }
}

function getCurrentSelectionSpec(pi: ExtensionAPI): ModeSpec {
    return {
        provider: lastObservedModel.provider,
        modelId: lastObservedModel.modelId,
        thinkingLevel: pi.getThinkingLevel(),
    };
}

async function storeSelectionIntoMode(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    mode: string,
    selection: ModeSpec,
): Promise<void> {
    if (mode === CUSTOM_MODE_NAME) return;

    await ensureRuntime(pi, ctx);

    const existingTarget = runtime.data.modes[mode] ?? {};
    const next: ModeSpec = { ...existingTarget };

    if (
        selection.provider !== undefined &&
        selection.provider.length > 0 &&
        selection.modelId !== undefined &&
        selection.modelId.length > 0
    ) {
        next.provider = selection.provider;
        next.modelId = selection.modelId;
    }
    if (selection.thinkingLevel !== undefined) next.thinkingLevel = selection.thinkingLevel;

    runtime.data.modes[mode] = next;
    await persistRuntime(pi, ctx);
}

async function applyMode(pi: ExtensionAPI, ctx: ExtensionContext, mode: string): Promise<void> {
    await ensureRuntime(pi, ctx);

    if (mode === CUSTOM_MODE_NAME) {
        runtime.currentMode = CUSTOM_MODE_NAME;
        customOverlay = getCurrentSelectionSpec(pi);
        if (ctx.hasUI) requestEditorRender?.();
        return;
    }

    const spec = modeSpec(runtime.data.modes, mode);
    if (spec === undefined) {
        if (ctx.hasUI) {
            ctx.ui.notify(`Unknown mode: ${mode}`, "warning");
        }
        return;
    }

    runtime.currentMode = mode;
    runtime.lastRealMode = mode;
    customOverlay = null;

    runtime.applying = true;
    let modelAppliedOk = true;
    try {
        if (
            spec.provider !== undefined &&
            spec.provider.length > 0 &&
            spec.modelId !== undefined &&
            spec.modelId.length > 0
        ) {
            const model = ctx.modelRegistry.find(spec.provider, spec.modelId);
            if (model !== undefined) {
                const ok = await pi.setModel(model);
                modelAppliedOk = ok;
                if (!ok && ctx.hasUI) {
                    ctx.ui.notify(
                        `No API key available for ${spec.provider}/${spec.modelId}`,
                        "warning",
                    );
                }
            } else {
                modelAppliedOk = false;
                if (ctx.hasUI) {
                    ctx.ui.notify(
                        `Mode "${mode}" references unknown model ${spec.provider}/${spec.modelId}`,
                        "warning",
                    );
                }
            }
        }

        if (spec.thinkingLevel !== undefined) {
            pi.setThinkingLevel(spec.thinkingLevel);
        }
    } finally {
        runtime.applying = false;
    }

    if (!modelAppliedOk) {
        runtime.currentMode = CUSTOM_MODE_NAME;
        customOverlay = getCurrentSelectionSpec(pi);
    }

    if (ctx.hasUI) {
        requestEditorRender?.();
    }
}

function isDefaultModeName(name: string): boolean {
    return (DEFAULT_MODE_ORDER as readonly string[]).includes(name);
}

function isReservedModeName(name: string): boolean {
    return (
        name === CUSTOM_MODE_NAME ||
        name === MODE_UI_CONFIGURE ||
        name === MODE_UI_ADD ||
        name === MODE_UI_BACK
    );
}

function normalizeModeNameInput(name: string | undefined): string {
    return (name ?? "").trim();
}

function validateModeNameOrError(
    name: string,
    existing: Record<string, ModeSpec>,
    options?: { allowExisting?: boolean },
): string | null {
    if (name.length === 0) return "Mode name cannot be empty";
    if (/\s/.test(name)) return "Mode name cannot contain whitespace";
    if (isReservedModeName(name)) return `Mode name "${name}" is reserved`;
    if (options?.allowExisting !== true && modeSpec(existing, name) !== undefined) {
        return `Mode "${name}" already exists`;
    }
    return null;
}

async function pickThinkingLevelForModeUI(
    ctx: ExtensionContext,
    current: ThinkingLevel | undefined,
): Promise<ThinkingLevel | null | undefined> {
    if (!ctx.hasUI) return undefined;

    const defaultValue = current ?? "off";
    const options = [...ALL_THINKING_LEVELS, THINKING_UNSET_LABEL];
    const ordered = [defaultValue, ...options.filter((value) => value !== defaultValue)];

    const choice = await ctx.ui.select("Thinking level", ordered);
    if (choice === undefined || choice.length === 0) return undefined;
    if (choice === THINKING_UNSET_LABEL) return null;
    if (ALL_THINKING_LEVELS.includes(choice as ThinkingLevel)) return choice as ThinkingLevel;
    return undefined;
}

async function pickModelForModeUI(
    ctx: ExtensionContext,
    spec: ModeSpec,
): Promise<{ provider: string; modelId: string } | undefined> {
    if (!ctx.hasUI) return undefined;

    const settingsManager = SettingsManager.inMemory();
    let currentModel = ctx.model;
    if (
        spec.provider !== undefined &&
        spec.provider.length > 0 &&
        spec.modelId !== undefined &&
        spec.modelId.length > 0
    ) {
        currentModel = ctx.modelRegistry.find(spec.provider, spec.modelId) ?? ctx.model;
    }

    const scopedModels: ScopedModelItem[] = [];

    return ctx.ui.custom<{ provider: string; modelId: string } | undefined>(
        (tui, _theme, _keybindings, done) => {
            const selector = new ModelSelectorComponent(
                tui,
                currentModel,
                settingsManager,
                ctx.modelRegistry,
                scopedModels,
                (model) => done({ provider: model.provider, modelId: model.id }),
                () => done(undefined),
            );
            return selector;
        },
    );
}

function renameModesRecord(
    modes: Record<string, ModeSpec>,
    oldName: string,
    newName: string,
): Record<string, ModeSpec> {
    const renamed: Record<string, ModeSpec> = {};
    for (const [key, value] of Object.entries(modes)) {
        let targetKey = key;
        if (key === oldName) {
            targetKey = newName;
        }
        renamed[targetKey] = value;
    }
    return renamed;
}

async function renameModeUI(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    oldName: string,
): Promise<string | undefined> {
    if (!ctx.hasUI) return undefined;

    if (isDefaultModeName(oldName)) {
        ctx.ui.notify(`Cannot rename default mode "${oldName}"`, "warning");
        return oldName;
    }

    await ensureRuntime(pi, ctx);

    while (true) {
        const raw = await ctx.ui.input(`Rename mode "${oldName}"`, oldName);
        if (raw === undefined) return undefined;

        const newName = normalizeModeNameInput(raw);
        if (newName.length === 0 || newName === oldName) return oldName;

        const error = validateModeNameOrError(newName, runtime.data.modes);
        if (error !== null) {
            ctx.ui.notify(error, "warning");
            continue;
        }

        runtime.data.modes = renameModesRecord(runtime.data.modes, oldName, newName);
        await persistRuntime(pi, ctx);

        if (runtime.currentMode === oldName) runtime.currentMode = newName;
        if (runtime.lastRealMode === oldName) runtime.lastRealMode = newName;
        requestEditorRender?.();

        ctx.ui.notify(`Renamed "${oldName}" → "${newName}"`, "info");
        return newName;
    }
}

async function editModeUI(pi: ExtensionAPI, ctx: ExtensionContext, mode: string): Promise<void> {
    if (!ctx.hasUI) return;

    let modeName = mode;

    while (true) {
        await ensureRuntime(pi, ctx);
        const spec = modeSpec(runtime.data.modes, modeName);
        if (spec === undefined) return;

        let modelLabel = "(no model)";
        if (
            spec.provider !== undefined &&
            spec.provider.length > 0 &&
            spec.modelId !== undefined &&
            spec.modelId.length > 0
        ) {
            modelLabel = `${spec.provider}/${spec.modelId}`;
        }
        const thinkingLabel = spec.thinkingLevel ?? THINKING_UNSET_LABEL;

        const actions = ["Change name", "Change model", "Change thinking level"];
        if (!isDefaultModeName(modeName)) actions.push("Delete mode");
        actions.push(MODE_UI_BACK);

        const action = await ctx.ui.select(
            `Edit mode "${modeName}"  model: ${modelLabel}  thinking: ${thinkingLabel}`,
            actions,
        );
        if (action === undefined || action.length === 0 || action === MODE_UI_BACK) return;

        if (action === "Change name") {
            const renamed = await renameModeUI(pi, ctx, modeName);
            if (renamed !== undefined && renamed.length > 0) modeName = renamed;
            continue;
        }

        if (action === "Change model") {
            const selected = await pickModelForModeUI(ctx, spec);
            if (selected === undefined) continue;
            spec.provider = selected.provider;
            spec.modelId = selected.modelId;
            runtime.data.modes[modeName] = spec;
            await persistRuntime(pi, ctx);
            ctx.ui.notify(`Updated model for "${modeName}"`, "info");

            if (runtime.currentMode === modeName) {
                await applyMode(pi, ctx, modeName);
            }
            continue;
        }

        if (action === "Change thinking level") {
            const level = await pickThinkingLevelForModeUI(ctx, spec.thinkingLevel);
            if (level === undefined) continue;

            if (level === null) {
                delete spec.thinkingLevel;
            } else {
                spec.thinkingLevel = level;
            }

            runtime.data.modes[modeName] = spec;
            await persistRuntime(pi, ctx);
            ctx.ui.notify(`Updated thinking level for "${modeName}"`, "info");

            if (runtime.currentMode === modeName) {
                await applyMode(pi, ctx, modeName);
            }
            continue;
        }

        if (action === "Delete mode") {
            const ok = await ctx.ui.confirm("Delete mode", `Delete mode "${modeName}"?`);
            if (ok !== true) continue;

            delete runtime.data.modes[modeName];
            await persistRuntime(pi, ctx);

            if (runtime.currentMode === modeName) {
                runtime.currentMode = CUSTOM_MODE_NAME;
                customOverlay = getCurrentSelectionSpec(pi);
            }
            if (runtime.lastRealMode === modeName) {
                runtime.lastRealMode = "default";
            }
            requestEditorRender?.();
            ctx.ui.notify(`Deleted mode "${modeName}"`, "info");
            return;
        }
    }
}

async function addModeUI(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string | undefined> {
    if (!ctx.hasUI) return undefined;
    await ensureRuntime(pi, ctx);

    while (true) {
        const raw = await ctx.ui.input("New mode name", "e.g. docs, review, planning");
        if (raw === undefined) return undefined;

        const name = normalizeModeNameInput(raw);
        const error = validateModeNameOrError(name, runtime.data.modes);
        if (error !== null) {
            ctx.ui.notify(error, "warning");
            continue;
        }

        let selection = getCurrentSelectionSpec(pi);
        if (customOverlay !== null) {
            selection = customOverlay;
        }
        runtime.data.modes[name] = {
            provider: selection.provider,
            modelId: selection.modelId,
            thinkingLevel: selection.thinkingLevel,
        };
        await persistRuntime(pi, ctx);
        ctx.ui.notify(`Added mode "${name}"`, "info");
        return name;
    }
}

async function configureModesUI(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    while (true) {
        await ensureRuntime(pi, ctx);
        const names = orderedModeNames(runtime.data.modes);
        let showModeNameChoice = MODE_UI_SHOW_NAME_OFF;
        if (shouldShowModeName()) {
            showModeNameChoice = MODE_UI_SHOW_NAME_ON;
        }
        const choice = await ctx.ui.select("Configure modes", [
            ...names,
            MODE_UI_ADD,
            showModeNameChoice,
            MODE_UI_BACK,
        ]);
        if (choice === undefined || choice.length === 0 || choice === MODE_UI_BACK) return;

        if (choice === MODE_UI_ADD) {
            const created = await addModeUI(pi, ctx);
            if (created !== undefined && created.length > 0) {
                await editModeUI(pi, ctx, created);
            }
            continue;
        }

        if (choice === MODE_UI_SHOW_NAME_ON || choice === MODE_UI_SHOW_NAME_OFF) {
            const next = !shouldShowModeName();
            try {
                setShowModeName(next);
            } catch (error: unknown) {
                ctx.ui.notify(`Mode name display was not saved: ${errorMessage(error)}`, "error");
                continue;
            }
            requestEditorRender?.();
            let displayState = "disabled";
            if (next) {
                displayState = "enabled";
            }
            ctx.ui.notify(`Mode name display ${displayState}`, "info");
            continue;
        }

        await editModeUI(pi, ctx, choice);
    }
}

async function handleModeChoiceUI(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    choice: string,
): Promise<void> {
    if (runtime.currentMode === CUSTOM_MODE_NAME && choice !== CUSTOM_MODE_NAME) {
        const action = await ctx.ui.select(`Mode "${choice}"`, ["use", "store"]);
        if (action === undefined || action.length === 0) return;

        if (action === "use") {
            await applyMode(pi, ctx, choice);
            return;
        }

        let overlay = getCurrentSelectionSpec(pi);
        if (customOverlay !== null) {
            overlay = customOverlay;
        }
        await storeSelectionIntoMode(pi, ctx, choice, overlay);
        await applyMode(pi, ctx, choice);
        ctx.ui.notify(`Stored ${CUSTOM_MODE_NAME} into "${choice}"`, "info");
        return;
    }

    await applyMode(pi, ctx, choice);
}

export async function selectModeUI(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    while (true) {
        await ensureRuntime(pi, ctx);
        const names = orderedModeNames(runtime.data.modes);
        const choice = await ctx.ui.select(`Mode (current: ${runtime.currentMode})`, [
            ...names,
            MODE_UI_CONFIGURE,
        ]);
        if (choice === undefined || choice.length === 0) return;

        if (choice === MODE_UI_CONFIGURE) {
            await configureModesUI(pi, ctx);
            continue;
        }

        await handleModeChoiceUI(pi, ctx, choice);
        return;
    }
}

export async function cycleMode(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    direction: 1 | -1 = 1,
): Promise<void> {
    if (!ctx.hasUI) return;
    await ensureRuntime(pi, ctx);
    const names = orderedModeNames(runtime.data.modes);
    if (names.length === 0) return;

    let baseMode = runtime.currentMode;
    if (runtime.currentMode === CUSTOM_MODE_NAME) {
        baseMode = runtime.lastRealMode;
    }
    const index = Math.max(0, names.indexOf(baseMode));
    const next = names[(index + direction + names.length) % names.length] ?? names[0]!;
    await applyMode(pi, ctx, next);
}

export async function handleModeCommand(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    args: string,
): Promise<void> {
    const tokens = args
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        await selectModeUI(pi, ctx);
        return;
    }

    if (tokens[0] === "store") {
        await ensureRuntime(pi, ctx);

        let target = tokens[1];
        if (target === undefined || target.length === 0) {
            if (!ctx.hasUI) return;
            const names = orderedModeNames(runtime.data.modes);
            const selectedTarget = await ctx.ui.select("Store current selection into mode", names);
            if (selectedTarget === undefined || selectedTarget.length === 0) return;
            target = selectedTarget;
        }

        if (target === CUSTOM_MODE_NAME) {
            if (ctx.hasUI) ctx.ui.notify(`Cannot store into "${CUSTOM_MODE_NAME}"`, "warning");
            return;
        }

        let selection = getCurrentSelectionSpec(pi);
        if (customOverlay !== null) {
            selection = customOverlay;
        }
        await storeSelectionIntoMode(pi, ctx, target, selection);
        if (ctx.hasUI) ctx.ui.notify(`Stored current selection into "${target}"`, "info");
        return;
    }

    await applyMode(pi, ctx, tokens[0]!);
}

export async function handleSessionActivated(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
): Promise<void> {
    lastObservedModel = { provider: ctx.model?.provider, modelId: ctx.model?.id };
    await ensureRuntime(pi, ctx);
    customOverlay = null;

    const inferred = inferModeFromSelection(ctx, pi, runtime.data);
    if (inferred !== null && inferred.length > 0) {
        runtime.currentMode = inferred;
        runtime.lastRealMode = inferred;
    } else {
        runtime.currentMode = CUSTOM_MODE_NAME;
        customOverlay = getCurrentSelectionSpec(pi);
    }
}

export async function handleModelSelect(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    event: { model: { provider: string; id: string } },
): Promise<void> {
    lastObservedModel = { provider: event.model.provider, modelId: event.model.id };

    if (runtime.applying) return;

    await ensureRuntime(pi, ctx);
    if (runtime.currentMode !== CUSTOM_MODE_NAME) {
        runtime.lastRealMode = runtime.currentMode;
    }
    runtime.currentMode = CUSTOM_MODE_NAME;

    customOverlay = {
        provider: event.model.provider,
        modelId: event.model.id,
        thinkingLevel: pi.getThinkingLevel(),
    };

    if (ctx.hasUI) {
        requestEditorRender?.();
    }
}
