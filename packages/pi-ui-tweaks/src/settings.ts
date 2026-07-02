import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI_TWEAKS_SETTINGS_KEY = "uiTweaks";

export type UiTweaksConfig = {
    readonly bashExecPromptSpacing: boolean;
    readonly compactModelSelector: boolean;
    readonly hideModelChangeStatus: boolean;
    readonly hideModelProviderHint: boolean;
    readonly hideSlashCommandSourceTags: boolean;
    readonly neutralBorderColor: boolean;
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
    bashExecPromptSpacing?: boolean;
    compactModelSelector?: boolean;
    enabled?: boolean;
    hideModelChangeStatus?: boolean;
    hideModelProviderHint?: boolean;
    hideSlashCommandSourceTags?: boolean;
    neutralBorderColor?: boolean;
};

const DEFAULT_UI_TWEAKS_CONFIG: UiTweaksConfig = {
    bashExecPromptSpacing: true,
    compactModelSelector: true,
    hideModelChangeStatus: true,
    hideModelProviderHint: true,
    hideSlashCommandSourceTags: true,
    neutralBorderColor: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalBoolean(
    record: Record<string, unknown>,
    key: keyof UiTweaksSettings,
    label: string,
): { value?: boolean; error?: string } {
    const value = record[key];
    if (value === undefined) {
        return {};
    }
    if (typeof value === "boolean") {
        return { value };
    }
    return { error: `${label}.${key} must be a boolean.` };
}

function parseUiTweaksSettings(
    settings: unknown,
    label: string,
): { settings: UiTweaksSettings; errors: string[] } {
    if (!isRecord(settings)) {
        return { settings: {}, errors: [`${label} must be a JSON object.`] };
    }

    const rawUiTweaks = settings[UI_TWEAKS_SETTINGS_KEY];
    if (rawUiTweaks === undefined) {
        return { settings: {}, errors: [] };
    }
    if (!isRecord(rawUiTweaks)) {
        return {
            settings: {},
            errors: [`${label}.${UI_TWEAKS_SETTINGS_KEY} must be a JSON object.`],
        };
    }

    const errors: string[] = [];
    const parsed: UiTweaksSettings = {};

    const enabled = readOptionalBoolean(
        rawUiTweaks,
        "enabled",
        `${label}.${UI_TWEAKS_SETTINGS_KEY}`,
    );
    if (enabled.error !== undefined) {
        errors.push(enabled.error);
    } else if (enabled.value !== undefined) {
        parsed.enabled = enabled.value;
    }

    const bashExecPromptSpacing = readOptionalBoolean(
        rawUiTweaks,
        "bashExecPromptSpacing",
        `${label}.${UI_TWEAKS_SETTINGS_KEY}`,
    );
    if (bashExecPromptSpacing.error !== undefined) {
        errors.push(bashExecPromptSpacing.error);
    } else if (bashExecPromptSpacing.value !== undefined) {
        parsed.bashExecPromptSpacing = bashExecPromptSpacing.value;
    }

    const compactModelSelector = readOptionalBoolean(
        rawUiTweaks,
        "compactModelSelector",
        `${label}.${UI_TWEAKS_SETTINGS_KEY}`,
    );
    if (compactModelSelector.error !== undefined) {
        errors.push(compactModelSelector.error);
    } else if (compactModelSelector.value !== undefined) {
        parsed.compactModelSelector = compactModelSelector.value;
    }

    const hideModelChangeStatus = readOptionalBoolean(
        rawUiTweaks,
        "hideModelChangeStatus",
        `${label}.${UI_TWEAKS_SETTINGS_KEY}`,
    );
    if (hideModelChangeStatus.error !== undefined) {
        errors.push(hideModelChangeStatus.error);
    } else if (hideModelChangeStatus.value !== undefined) {
        parsed.hideModelChangeStatus = hideModelChangeStatus.value;
    }

    const hideModelProviderHint = readOptionalBoolean(
        rawUiTweaks,
        "hideModelProviderHint",
        `${label}.${UI_TWEAKS_SETTINGS_KEY}`,
    );
    if (hideModelProviderHint.error !== undefined) {
        errors.push(hideModelProviderHint.error);
    } else if (hideModelProviderHint.value !== undefined) {
        parsed.hideModelProviderHint = hideModelProviderHint.value;
    }

    const hideSlashCommandSourceTags = readOptionalBoolean(
        rawUiTweaks,
        "hideSlashCommandSourceTags",
        `${label}.${UI_TWEAKS_SETTINGS_KEY}`,
    );
    if (hideSlashCommandSourceTags.error !== undefined) {
        errors.push(hideSlashCommandSourceTags.error);
    } else if (hideSlashCommandSourceTags.value !== undefined) {
        parsed.hideSlashCommandSourceTags = hideSlashCommandSourceTags.value;
    }

    const neutralBorderColor = readOptionalBoolean(
        rawUiTweaks,
        "neutralBorderColor",
        `${label}.${UI_TWEAKS_SETTINGS_KEY}`,
    );
    if (neutralBorderColor.error !== undefined) {
        errors.push(neutralBorderColor.error);
    } else if (neutralBorderColor.value !== undefined) {
        parsed.neutralBorderColor = neutralBorderColor.value;
    }

    return { settings: parsed, errors };
}

function buildUiTweaksConfig(settings: UiTweaksSettings): UiTweaksConfig {
    if (settings.enabled === false) {
        return {
            bashExecPromptSpacing: false,
            compactModelSelector: false,
            hideModelChangeStatus: false,
            hideModelProviderHint: false,
            hideSlashCommandSourceTags: false,
            neutralBorderColor: false,
        };
    }

    return {
        bashExecPromptSpacing:
            settings.bashExecPromptSpacing ?? DEFAULT_UI_TWEAKS_CONFIG.bashExecPromptSpacing,
        compactModelSelector:
            settings.compactModelSelector ?? DEFAULT_UI_TWEAKS_CONFIG.compactModelSelector,
        hideModelChangeStatus:
            settings.hideModelChangeStatus ?? DEFAULT_UI_TWEAKS_CONFIG.hideModelChangeStatus,
        hideModelProviderHint:
            settings.hideModelProviderHint ?? DEFAULT_UI_TWEAKS_CONFIG.hideModelProviderHint,
        hideSlashCommandSourceTags:
            settings.hideSlashCommandSourceTags ??
            DEFAULT_UI_TWEAKS_CONFIG.hideSlashCommandSourceTags,
        neutralBorderColor:
            settings.neutralBorderColor ?? DEFAULT_UI_TWEAKS_CONFIG.neutralBorderColor,
    };
}

/**
 * Resolves UI tweak settings from already-parsed Pi settings objects in precedence order.
 */
export function resolveUiTweaksConfig(
    settingsSources: readonly UiTweaksSettingsSource[],
): LoadedUiTweaksConfig {
    let mergedSettings: UiTweaksSettings = {};
    const errors: string[] = [];

    for (const source of settingsSources) {
        const parsed = parseUiTweaksSettings(source.settings, source.label);
        mergedSettings = { ...mergedSettings, ...parsed.settings };
        errors.push(...parsed.errors);
    }

    return {
        config: buildUiTweaksConfig(mergedSettings),
        errors,
    };
}

function readSettingsFile(path: string, label: string): { settings?: unknown; error?: string } {
    try {
        const raw = readFileSync(path, "utf8");
        return { settings: JSON.parse(raw) as unknown };
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
 * Loads UI tweak settings from Pi global settings and trusted project settings.
 */
export function loadUiTweaksConfig(cwd: string, projectTrusted: boolean): LoadedUiTweaksConfig {
    const globalSettingsPath = join(getAgentDir(), "settings.json");
    const globalSettings = readSettingsFile(globalSettingsPath, globalSettingsPath);
    const settingsSources: UiTweaksSettingsSource[] = [];
    const errors: string[] = [];

    if (globalSettings.settings !== undefined) {
        settingsSources.push({ label: globalSettingsPath, settings: globalSettings.settings });
    }
    if (globalSettings.error !== undefined) {
        errors.push(globalSettings.error);
    }

    if (projectTrusted) {
        const projectSettingsPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
        const projectSettings = readSettingsFile(projectSettingsPath, projectSettingsPath);
        if (projectSettings.settings !== undefined) {
            settingsSources.push({
                label: projectSettingsPath,
                settings: projectSettings.settings,
            });
        }
        if (projectSettings.error !== undefined) {
            errors.push(projectSettings.error);
        }
    }

    const loaded = resolveUiTweaksConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}
