import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FOOTER_SETTINGS_KEY = "footer";

export type FooterConfig = {
    readonly separator: string;
};

export type LoadedFooterConfig = {
    readonly config: FooterConfig;
    readonly errors: readonly string[];
};

export type FooterSettingsSource = {
    readonly label: string;
    readonly settings: unknown;
};

type FooterSettings = {
    readonly separator?: string;
};

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
    separator: "|",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSeparator(value: string): string {
    return value
        .replace(/[\r\n\t]/g, " ")
        .replace(/ +/g, " ")
        .trim();
}

function parseFooterSettings(
    settings: unknown,
    label: string,
): { settings: FooterSettings; errors: string[] } {
    if (!isRecord(settings)) {
        return { settings: {}, errors: [`${label} must be a JSON object.`] };
    }

    const rawFooter = settings[FOOTER_SETTINGS_KEY];
    if (rawFooter === undefined) {
        return { settings: {}, errors: [] };
    }
    if (!isRecord(rawFooter)) {
        return {
            settings: {},
            errors: [`${label}.${FOOTER_SETTINGS_KEY} must be a JSON object.`],
        };
    }

    const parsed: FooterSettings = {};
    const errors: string[] = [];
    const separator = rawFooter.separator;
    if (separator !== undefined) {
        if (typeof separator !== "string") {
            errors.push(`${label}.${FOOTER_SETTINGS_KEY}.separator must be a string.`);
        } else {
            const sanitized = sanitizeSeparator(separator);
            if (sanitized.length === 0) {
                errors.push(
                    `${label}.${FOOTER_SETTINGS_KEY}.separator must contain a visible character.`,
                );
            } else {
                return { settings: { separator: sanitized }, errors };
            }
        }
    }

    return { settings: parsed, errors };
}

function buildFooterConfig(settings: FooterSettings): FooterConfig {
    return {
        separator: settings.separator ?? DEFAULT_FOOTER_CONFIG.separator,
    };
}

export function resolveFooterConfig(
    settingsSources: readonly FooterSettingsSource[],
): LoadedFooterConfig {
    let mergedSettings: FooterSettings = {};
    const errors: string[] = [];

    for (const source of settingsSources) {
        const parsed = parseFooterSettings(source.settings, source.label);
        mergedSettings = { ...mergedSettings, ...parsed.settings };
        errors.push(...parsed.errors);
    }

    return {
        config: buildFooterConfig(mergedSettings),
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

export function loadFooterConfig(cwd: string, projectTrusted: boolean): LoadedFooterConfig {
    const globalSettingsPath = join(getAgentDir(), "settings.json");
    const globalSettings = readSettingsFile(globalSettingsPath, globalSettingsPath);
    const settingsSources: FooterSettingsSource[] = [];
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

    const loaded = resolveFooterConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}
