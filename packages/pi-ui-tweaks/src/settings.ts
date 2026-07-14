import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import { loadPiExtensionSettings } from "@zigai/pi-extension-settings/pi";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import {
    DEFAULT_PASTE_COLLAPSE_CHAR_THRESHOLD,
    DEFAULT_PASTE_COLLAPSE_ENABLED,
    DEFAULT_PASTE_COLLAPSE_EXPAND_KEY,
    DEFAULT_PASTE_COLLAPSE_LINE_THRESHOLD,
    DEFAULT_PASTE_COLLAPSE_USE_TOOL_EXPAND_KEY,
} from "./patch-state.ts";

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

export const uiTweaksSettingsDefinition = defineExtensionSettings({
    id: "pi-ui-tweaks",
    title: "Pi UI Tweaks",
    description: "Settings for Pi interactive-interface behavior and presentation tweaks.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-ui-tweaks/config.schema.json",
    schema: Type.Object(
        {
            enabled: Type.Boolean({ default: true, description: "Enable all UI tweaks." }),
            autocompleteAboveInput: Type.Boolean({
                default: true,
                description: "Render autocomplete above the input editor.",
            }),
            bashExecPromptSpacing: Type.Boolean({
                default: true,
                description: "Add spacing around bash execution prompts.",
            }),
            anchorInputToBottom: Type.Boolean({
                default: false,
                description: "Anchor the input editor to the terminal bottom.",
            }),
            compactModelSelector: Type.Boolean({
                default: true,
                description: "Use compact model-selector rows.",
            }),
            hideAutocompleteScrollInfo: Type.Boolean({
                default: true,
                description: "Hide autocomplete scroll-position text.",
            }),
            hideModelChangeStatus: Type.Boolean({
                default: true,
                description: "Hide model-change status messages.",
            }),
            hideModelProviderHint: Type.Boolean({
                default: true,
                description: "Hide provider hints in the model selector.",
            }),
            hideSlashCommandSourceTags: Type.Boolean({
                default: true,
                description: "Hide source tags in slash-command completion.",
            }),
            highlightSelectedModelProvider: Type.Boolean({
                default: true,
                description: "Highlight the selected model provider.",
            }),
            inputPromptPrefix: Type.String({
                minLength: 1,
                default: "> ",
                description: "Prefix displayed before input text.",
            }),
            neutralBorderColor: Type.Boolean({
                default: true,
                description: "Use a neutral border color when Pi is idle.",
            }),
            pasteCollapseCharThreshold: Type.Integer({
                minimum: 0,
                default: DEFAULT_PASTE_COLLAPSE_CHAR_THRESHOLD,
                description: "Character threshold that collapses pasted content.",
            }),
            pasteCollapseEnabled: Type.Boolean({
                default: DEFAULT_PASTE_COLLAPSE_ENABLED,
                description: "Collapse large pasted content.",
            }),
            pasteCollapseExpandKey: Type.Union(OptionalPasteCollapseExpandKeySchema.anyOf, {
                default: DEFAULT_PASTE_COLLAPSE_EXPAND_KEY,
                description: "Explicit key used to expand collapsed pasted content.",
            }),
            pasteCollapseLineThreshold: Type.Integer({
                minimum: 0,
                default: DEFAULT_PASTE_COLLAPSE_LINE_THRESHOLD,
                description: "Line threshold that collapses pasted content.",
            }),
            pasteCollapseUseToolExpandKey: Type.Boolean({
                default: DEFAULT_PASTE_COLLAPSE_USE_TOOL_EXPAND_KEY,
                description: "Reuse Pi's configured tool-expansion key for pasted content.",
            }),
            preserveCompactionHistory: Type.Boolean({
                default: false,
                description: "Keep pre-compaction messages visible in transcript history.",
            }),
            restoreContentAfterAutocompleteClose: Type.Boolean({
                default: true,
                description: "Restore editor content after closing autocomplete.",
            }),
            selectedOptionPrefix: Type.String({
                minLength: 1,
                default: "→ ",
                description: "Prefix displayed before selected list options.",
            }),
        },
        { additionalProperties: false },
    ),
});

export default uiTweaksSettingsDefinition;

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

/** Load UI tweak settings from global and trusted-project extension settings. */
export function loadUiTweaksSettings(cwd: string, projectTrusted: boolean): LoadedUiTweaksConfig {
    const settings = loadPiExtensionSettings(
        uiTweaksSettingsDefinition,
        { cwd, isProjectTrusted: () => projectTrusted },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
    const settingsSources: UiTweaksSettingsSource[] = [];
    if (settings.globalSettingsLayer !== undefined) {
        settingsSources.push({
            label: settings.globalConfigPath,
            settings: settings.globalSettingsLayer,
        });
    }
    if (settings.projectSettingsLayer !== undefined && settings.projectConfigPath !== undefined) {
        settingsSources.push({
            label: settings.projectConfigPath,
            settings: settings.projectSettingsLayer,
        });
    }

    const loaded = resolveUiTweaksConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...settings.diagnostics.map((diagnostic) => diagnostic.message), ...loaded.errors],
    };
}
