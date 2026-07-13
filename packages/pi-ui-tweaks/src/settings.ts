import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import {
    DEFAULT_PASTE_COLLAPSE_CHAR_THRESHOLD,
    DEFAULT_PASTE_COLLAPSE_ENABLED,
    DEFAULT_PASTE_COLLAPSE_EXPAND_KEY,
    DEFAULT_PASTE_COLLAPSE_LINE_THRESHOLD,
    DEFAULT_PASTE_COLLAPSE_USE_TOOL_EXPAND_KEY,
} from "./patch-state.ts";

const EXTENSION_ID = "pi-ui-tweaks";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";

export type UiTweaksConfig = {
    readonly autocompleteAboveInput: boolean;
    readonly bashExecPromptSpacing: boolean;
    readonly anchorInputToBottom: boolean;
    readonly compactModelSelector: boolean;
    readonly hideAutocompleteScrollInfo: boolean;
    readonly hideModelChangeStatus: boolean;
    readonly hideModelProviderHint: boolean;
    readonly hideSlashCommandSourceTags: boolean;
    readonly highlightSelectedModelProvider: boolean;
    readonly inputPromptPrefix: string;
    readonly neutralBorderColor: boolean;
    readonly pasteCollapseCharThreshold: number;
    readonly pasteCollapseEnabled: boolean;
    readonly pasteCollapseExpandKey: string | null;
    readonly pasteCollapseLineThreshold: number;
    readonly pasteCollapseUseToolExpandKey: boolean;
    readonly preserveCompactionHistory: boolean;
    readonly restoreContentAfterAutocompleteClose: boolean;
    readonly selectedOptionPrefix: string;
};

export type LoadedUiTweaksConfig = {
    readonly config: UiTweaksConfig;
    readonly errors: readonly string[];
};

export type UiTweaksSettingsSource = {
    readonly label: string;
    readonly settings: unknown;
};

type UiTweaksSettings = {
    $schema?: string;
    autocompleteAboveInput?: boolean;
    bashExecPromptSpacing?: boolean;
    anchorInputToBottom?: boolean;
    compactModelSelector?: boolean;
    enabled?: boolean;
    hideAutocompleteScrollInfo?: boolean;
    hideModelChangeStatus?: boolean;
    hideModelProviderHint?: boolean;
    hideSlashCommandSourceTags?: boolean;
    highlightSelectedModelProvider?: boolean;
    inputPromptPrefix?: string;
    neutralBorderColor?: boolean;
    pasteCollapseCharThreshold?: number;
    pasteCollapseEnabled?: boolean;
    pasteCollapseExpandKey?: string | null;
    pasteCollapseLineThreshold?: number;
    pasteCollapseUseToolExpandKey?: boolean;
    preserveCompactionHistory?: boolean;
    restoreContentAfterAutocompleteClose?: boolean;
    selectedOptionPrefix?: string;
};

const PASTE_COLLAPSE_EXPAND_KEY_PATTERN =
    "^(?:(?:ctrl|shift|alt|super)\\+)*(?:[a-z0-9]|escape|esc|enter|return|tab|space|backspace|delete|insert|clear|home|end|pageUp|pageDown|pageup|pagedown|up|down|left|right|f(?:[1-9]|1[0-2])|[`\\-=\\[\\]\\\\;',./!@#$%^&*()_|~{}:<>?])$";

const OptionalPasteCollapseExpandKeySchema = Type.Union([
    Type.String({ minLength: 1, pattern: PASTE_COLLAPSE_EXPAND_KEY_PATTERN }),
    Type.Null(),
]);

const UiTweaksConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        autocompleteAboveInput: Type.Optional(Type.Boolean()),
        bashExecPromptSpacing: Type.Optional(Type.Boolean()),
        anchorInputToBottom: Type.Optional(Type.Boolean()),
        compactModelSelector: Type.Optional(Type.Boolean()),
        enabled: Type.Optional(Type.Boolean()),
        hideAutocompleteScrollInfo: Type.Optional(Type.Boolean()),
        hideModelChangeStatus: Type.Optional(Type.Boolean()),
        hideModelProviderHint: Type.Optional(Type.Boolean()),
        hideSlashCommandSourceTags: Type.Optional(Type.Boolean()),
        highlightSelectedModelProvider: Type.Optional(Type.Boolean()),
        inputPromptPrefix: Type.Optional(Type.String({ minLength: 1 })),
        neutralBorderColor: Type.Optional(Type.Boolean()),
        pasteCollapseCharThreshold: Type.Optional(Type.Integer({ minimum: 0 })),
        pasteCollapseEnabled: Type.Optional(Type.Boolean()),
        pasteCollapseExpandKey: Type.Optional(OptionalPasteCollapseExpandKeySchema),
        pasteCollapseLineThreshold: Type.Optional(Type.Integer({ minimum: 0 })),
        pasteCollapseUseToolExpandKey: Type.Optional(Type.Boolean()),
        preserveCompactionHistory: Type.Optional(Type.Boolean()),
        restoreContentAfterAutocompleteClose: Type.Optional(Type.Boolean()),
        selectedOptionPrefix: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
);

type ParsedUiTweaksConfig = Static<typeof UiTweaksConfigSchema>;

const DEFAULT_UI_TWEAKS_CONFIG: UiTweaksConfig = {
    autocompleteAboveInput: true,
    bashExecPromptSpacing: true,
    anchorInputToBottom: false,
    compactModelSelector: true,
    hideAutocompleteScrollInfo: true,
    hideModelChangeStatus: true,
    hideModelProviderHint: true,
    hideSlashCommandSourceTags: true,
    highlightSelectedModelProvider: true,
    inputPromptPrefix: "> ",
    neutralBorderColor: true,
    pasteCollapseCharThreshold: DEFAULT_PASTE_COLLAPSE_CHAR_THRESHOLD,
    pasteCollapseEnabled: DEFAULT_PASTE_COLLAPSE_ENABLED,
    pasteCollapseExpandKey: DEFAULT_PASTE_COLLAPSE_EXPAND_KEY,
    pasteCollapseLineThreshold: DEFAULT_PASTE_COLLAPSE_LINE_THRESHOLD,
    pasteCollapseUseToolExpandKey: DEFAULT_PASTE_COLLAPSE_USE_TOOL_EXPAND_KEY,
    preserveCompactionHistory: false,
    restoreContentAfterAutocompleteClose: true,
    selectedOptionPrefix: "→ ",
};

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

function parseSchema<Schema extends TSchema>(
    schema: Schema,
    value: unknown,
    label: string,
): Static<Schema> {
    const errors = [...Value.Errors(schema, value)];
    if (errors.length > 0) {
        const messages = errors
            .slice(0, 10)
            .map((error) => `${formatSchemaPath(error.instancePath)} ${error.message}`);
        let suffix = "";
        if (errors.length > messages.length) {
            suffix = `; and ${errors.length - messages.length} more`;
        }
        throw new Error(`${label} is invalid: ${messages.join("; ")}${suffix}`);
    }
    const parsed: unknown = Value.Parse(schema, value);
    // SAFETY: Value.Errors returned no schema violations, so Value.Parse returns
    // the TypeBox static type represented by the same schema.
    // oxlint-disable-next-line typescript/no-unsafe-return -- SAFETY: TypeBox exposes parsed schema output through a conditional static type that oxlint treats as any here.
    return parsed as Static<Schema>;
}

function parseUiTweaksSettings(
    settings: unknown,
    label: string,
): { settings: UiTweaksSettings; errors: string[] } {
    try {
        const parsed = parseSchema(UiTweaksConfigSchema, settings, label);
        return { settings: parsed, errors: [] };
    } catch (error: unknown) {
        let message: string;
        if (error instanceof Error) {
            message = error.message;
        } else {
            message = String(error);
        }
        return { settings: {}, errors: [message] };
    }
}

function buildUiTweaksConfig(settings: UiTweaksSettings): UiTweaksConfig {
    if (settings.enabled === false) {
        return {
            autocompleteAboveInput: false,
            bashExecPromptSpacing: false,
            anchorInputToBottom: false,
            compactModelSelector: false,
            hideAutocompleteScrollInfo: false,
            hideModelChangeStatus: false,
            hideModelProviderHint: false,
            hideSlashCommandSourceTags: false,
            highlightSelectedModelProvider: false,
            inputPromptPrefix: DEFAULT_UI_TWEAKS_CONFIG.inputPromptPrefix,
            neutralBorderColor: false,
            pasteCollapseCharThreshold: DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseCharThreshold,
            pasteCollapseEnabled: false,
            pasteCollapseExpandKey: DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseExpandKey,
            pasteCollapseLineThreshold: DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseLineThreshold,
            pasteCollapseUseToolExpandKey: false,
            preserveCompactionHistory: false,
            restoreContentAfterAutocompleteClose: false,
            selectedOptionPrefix: DEFAULT_UI_TWEAKS_CONFIG.selectedOptionPrefix,
        };
    }

    return {
        autocompleteAboveInput:
            settings.autocompleteAboveInput ?? DEFAULT_UI_TWEAKS_CONFIG.autocompleteAboveInput,
        bashExecPromptSpacing:
            settings.bashExecPromptSpacing ?? DEFAULT_UI_TWEAKS_CONFIG.bashExecPromptSpacing,
        anchorInputToBottom:
            settings.anchorInputToBottom ?? DEFAULT_UI_TWEAKS_CONFIG.anchorInputToBottom,
        compactModelSelector:
            settings.compactModelSelector ?? DEFAULT_UI_TWEAKS_CONFIG.compactModelSelector,
        hideAutocompleteScrollInfo:
            settings.hideAutocompleteScrollInfo ??
            DEFAULT_UI_TWEAKS_CONFIG.hideAutocompleteScrollInfo,
        hideModelChangeStatus:
            settings.hideModelChangeStatus ?? DEFAULT_UI_TWEAKS_CONFIG.hideModelChangeStatus,
        hideModelProviderHint:
            settings.hideModelProviderHint ?? DEFAULT_UI_TWEAKS_CONFIG.hideModelProviderHint,
        hideSlashCommandSourceTags:
            settings.hideSlashCommandSourceTags ??
            DEFAULT_UI_TWEAKS_CONFIG.hideSlashCommandSourceTags,
        highlightSelectedModelProvider:
            settings.highlightSelectedModelProvider ??
            DEFAULT_UI_TWEAKS_CONFIG.highlightSelectedModelProvider,
        inputPromptPrefix: settings.inputPromptPrefix ?? DEFAULT_UI_TWEAKS_CONFIG.inputPromptPrefix,
        neutralBorderColor:
            settings.neutralBorderColor ?? DEFAULT_UI_TWEAKS_CONFIG.neutralBorderColor,
        pasteCollapseCharThreshold:
            settings.pasteCollapseCharThreshold ??
            DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseCharThreshold,
        pasteCollapseEnabled:
            settings.pasteCollapseEnabled ?? DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseEnabled,
        pasteCollapseExpandKey:
            settings.pasteCollapseExpandKey ?? DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseExpandKey,
        pasteCollapseLineThreshold:
            settings.pasteCollapseLineThreshold ??
            DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseLineThreshold,
        pasteCollapseUseToolExpandKey:
            settings.pasteCollapseUseToolExpandKey ??
            DEFAULT_UI_TWEAKS_CONFIG.pasteCollapseUseToolExpandKey,
        preserveCompactionHistory:
            settings.preserveCompactionHistory ??
            DEFAULT_UI_TWEAKS_CONFIG.preserveCompactionHistory,
        restoreContentAfterAutocompleteClose:
            settings.restoreContentAfterAutocompleteClose ??
            DEFAULT_UI_TWEAKS_CONFIG.restoreContentAfterAutocompleteClose,
        selectedOptionPrefix:
            settings.selectedOptionPrefix ?? DEFAULT_UI_TWEAKS_CONFIG.selectedOptionPrefix,
    };
}

/**
 * Resolves UI tweak settings from already-parsed extension config objects in precedence order.
 */
export function resolveUiTweaksConfig(
    settingsSources: readonly UiTweaksSettingsSource[],
): LoadedUiTweaksConfig {
    let mergedSettings: UiTweaksSettings = {};
    const errors: string[] = [];

    for (const source of settingsSources) {
        const parsed = parseUiTweaksSettings(source.settings, source.label);
        Object.assign(mergedSettings, parsed.settings);
        errors.push(...parsed.errors);
    }

    return {
        config: buildUiTweaksConfig(mergedSettings),
        errors,
    };
}

const DEFAULT_UI_TWEAKS_CONFIG_FILE: ParsedUiTweaksConfig = {
    $schema: `./${SCHEMA_FILE}`,
    enabled: true,
    ...DEFAULT_UI_TWEAKS_CONFIG,
};

function getGlobalConfigPath(): string {
    return join(getAgentDir(), EXTENSION_ID, CONFIG_FILE);
}

function getProjectConfigPath(cwd: string): string {
    return join(cwd, CONFIG_DIR_NAME, EXTENSION_ID, CONFIG_FILE);
}

function getSchemaPath(configPath: string): string {
    return join(dirname(configPath), SCHEMA_FILE);
}

function writeIfMissing(filePath: string, content: string): void {
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
    } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST") return;
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

function refreshSchemaFile(filePath: string, content: string): void {
    let temporaryPath: string | undefined;
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        try {
            if (readFileSync(filePath, "utf8") === content) return;
        } catch (error: unknown) {
            if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }

        const nextTemporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        writeFileSync(nextTemporaryPath, content, { encoding: "utf8", flag: "wx" });
        temporaryPath = nextTemporaryPath;
        renameSync(temporaryPath, filePath);
        temporaryPath = undefined;
    } catch (error: unknown) {
        if (temporaryPath !== undefined) {
            try {
                unlinkSync(temporaryPath);
            } catch {
                // Ignore cleanup failure while reporting the original scaffold failure.
            }
        }
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

function readBundledSchema(): string | undefined {
    try {
        return readFileSync(new URL("../config.schema.json", import.meta.url), "utf8");
    } catch {
        return undefined;
    }
}

function scaffoldGlobalConfig(): void {
    const globalConfigPath = getGlobalConfigPath();
    const schema = readBundledSchema();
    if (schema !== undefined) {
        refreshSchemaFile(getSchemaPath(globalConfigPath), schema);
    }
    writeIfMissing(globalConfigPath, `${JSON.stringify(DEFAULT_UI_TWEAKS_CONFIG_FILE, null, 2)}\n`);
}

function readConfigFile(path: string, label: string): { settings?: unknown; error?: string } {
    try {
        const raw = readFileSync(path, "utf8");
        const settings: unknown = JSON.parse(raw);
        return { settings };
    } catch (cause: unknown) {
        if (
            typeof cause === "object" &&
            cause !== null &&
            Reflect.get(cause, "code") === "ENOENT"
        ) {
            return {};
        }

        let message: string;
        if (cause instanceof Error) {
            message = cause.message;
        } else {
            message = String(cause);
        }
        return { error: `Failed to read ${label}: ${message}` };
    }
}

/**
 * Loads UI tweak settings from extension global config and trusted project config.
 */
export function loadUiTweaksConfig(cwd: string, projectTrusted: boolean): LoadedUiTweaksConfig {
    scaffoldGlobalConfig();
    const globalConfigPath = getGlobalConfigPath();
    const globalConfig = readConfigFile(globalConfigPath, globalConfigPath);
    const settingsSources: UiTweaksSettingsSource[] = [];
    const errors: string[] = [];

    if (globalConfig.settings !== undefined) {
        settingsSources.push({ label: globalConfigPath, settings: globalConfig.settings });
    }
    if (globalConfig.error !== undefined) {
        errors.push(globalConfig.error);
    }

    if (projectTrusted) {
        const projectConfigPath = getProjectConfigPath(cwd);
        const projectConfig = readConfigFile(projectConfigPath, projectConfigPath);
        if (projectConfig.settings !== undefined) {
            settingsSources.push({
                label: projectConfigPath,
                settings: projectConfig.settings,
            });
        }
        if (projectConfig.error !== undefined) {
            errors.push(projectConfig.error);
        }
    }

    const loaded = resolveUiTweaksConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}
