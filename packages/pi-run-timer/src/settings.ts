import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const RUN_TIMER_SETTINGS_KEY = "runTimer";
const RIGHT_MESSAGES_SETTINGS_KEY = "rightMessages";
const DEFAULT_RIGHT_MESSAGE_INTERVAL_MS = 10_000;
const DEFAULT_RIGHT_MESSAGE_MIN_GAP = 4;
const DEFAULT_RIGHT_MESSAGE_SCROLL_COLUMN_INTERVAL_MS = 120;
const DEFAULT_RIGHT_MESSAGE_MIN_SCROLL_CYCLES = 1;

export type RightMessagesConfig = {
    readonly enabled: boolean;
    readonly intervalMs: number;
    readonly minGap: number;
    readonly minScrollCycles: number;
    readonly scrollColumnIntervalMs: number;
    readonly dimmed: boolean;
    readonly italic: boolean;
    readonly messages: readonly string[];
};

export type RunTimerConfig = {
    readonly rightMessages: RightMessagesConfig;
};

export type LoadedRunTimerConfig = {
    readonly config: RunTimerConfig;
    readonly errors: readonly string[];
};

export type RunTimerSettingsSource = {
    readonly label: string;
    readonly baseDir: string;
    readonly settings: unknown;
};

type MessageFileReference = {
    readonly path: string;
    readonly baseDir: string;
    readonly label: string;
};

type RightMessagesSettings = {
    readonly enabled?: boolean;
    readonly intervalMs?: number;
    readonly minGap?: number;
    readonly minScrollCycles?: number;
    readonly scrollColumnIntervalMs?: number;
    readonly dimmed?: boolean;
    readonly italic?: boolean;
    readonly messages?: readonly string[];
    readonly messagesFile?: MessageFileReference;
};

type RunTimerSettings = {
    readonly rightMessages?: RightMessagesSettings;
};

export const DEFAULT_RIGHT_MESSAGES_CONFIG: RightMessagesConfig = {
    enabled: false,
    intervalMs: DEFAULT_RIGHT_MESSAGE_INTERVAL_MS,
    minGap: DEFAULT_RIGHT_MESSAGE_MIN_GAP,
    minScrollCycles: DEFAULT_RIGHT_MESSAGE_MIN_SCROLL_CYCLES,
    scrollColumnIntervalMs: DEFAULT_RIGHT_MESSAGE_SCROLL_COLUMN_INTERVAL_MS,
    dimmed: true,
    italic: true,
    messages: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalBoolean(
    record: Record<string, unknown>,
    key: keyof RightMessagesSettings,
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

function readOptionalPositiveInteger(
    record: Record<string, unknown>,
    key: keyof RightMessagesSettings,
    label: string,
): { value?: number; error?: string } {
    const value = record[key];
    if (value === undefined) {
        return {};
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        return { error: `${label}.${key} must be a positive integer.` };
    }
    return { value };
}

function readOptionalNonNegativeInteger(
    record: Record<string, unknown>,
    key: keyof RightMessagesSettings,
    label: string,
): { value?: number; error?: string } {
    const value = record[key];
    if (value === undefined) {
        return {};
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return { error: `${label}.${key} must be a non-negative integer.` };
    }
    return { value };
}

function readOptionalMessages(
    record: Record<string, unknown>,
    label: string,
): { value?: readonly string[]; errors: string[] } {
    const value = record.messages;
    if (value === undefined) {
        return { errors: [] };
    }
    if (!Array.isArray(value)) {
        return { errors: [`${label}.messages must be an array of strings.`] };
    }

    const messages: string[] = [];
    const errors: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (typeof entry !== "string") {
            errors.push(`${label}.messages[${index}] must be a string.`);
            continue;
        }

        const message = entry.trim();
        if (message.length > 0) {
            messages.push(message);
        }
    }

    return { value: messages, errors };
}

function readOptionalMessagesFile(
    record: Record<string, unknown>,
    label: string,
    baseDir: string,
): { value?: MessageFileReference; error?: string } {
    const value = record.messagesFile;
    if (value === undefined) {
        return {};
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        return { error: `${label}.messagesFile must be a non-empty string.` };
    }
    return {
        value: {
            path: value.trim(),
            baseDir,
            label: `${label}.messagesFile`,
        },
    };
}

function parseRightMessagesSettings(
    settings: unknown,
    label: string,
    baseDir: string,
): { settings: RightMessagesSettings; errors: string[] } {
    if (settings === undefined) {
        return { settings: {}, errors: [] };
    }
    if (!isRecord(settings)) {
        return {
            settings: {},
            errors: [`${label}.${RIGHT_MESSAGES_SETTINGS_KEY} must be a JSON object.`],
        };
    }

    const errors: string[] = [];
    const parsed: {
        enabled?: boolean;
        intervalMs?: number;
        minGap?: number;
        minScrollCycles?: number;
        scrollColumnIntervalMs?: number;
        dimmed?: boolean;
        italic?: boolean;
        messages?: readonly string[];
        messagesFile?: MessageFileReference;
    } = {};
    const rightMessagesLabel = `${label}.${RIGHT_MESSAGES_SETTINGS_KEY}`;

    const enabled = readOptionalBoolean(settings, "enabled", rightMessagesLabel);
    if (enabled.error !== undefined) {
        errors.push(enabled.error);
    } else if (enabled.value !== undefined) {
        parsed.enabled = enabled.value;
    }

    const intervalMs = readOptionalPositiveInteger(settings, "intervalMs", rightMessagesLabel);
    if (intervalMs.error !== undefined) {
        errors.push(intervalMs.error);
    } else if (intervalMs.value !== undefined) {
        parsed.intervalMs = intervalMs.value;
    }

    const minGap = readOptionalNonNegativeInteger(settings, "minGap", rightMessagesLabel);
    if (minGap.error !== undefined) {
        errors.push(minGap.error);
    } else if (minGap.value !== undefined) {
        parsed.minGap = minGap.value;
    }

    const minScrollCycles = readOptionalPositiveInteger(
        settings,
        "minScrollCycles",
        rightMessagesLabel,
    );
    if (minScrollCycles.error !== undefined) {
        errors.push(minScrollCycles.error);
    } else if (minScrollCycles.value !== undefined) {
        parsed.minScrollCycles = minScrollCycles.value;
    }

    const scrollColumnIntervalMs = readOptionalPositiveInteger(
        settings,
        "scrollColumnIntervalMs",
        rightMessagesLabel,
    );
    if (scrollColumnIntervalMs.error !== undefined) {
        errors.push(scrollColumnIntervalMs.error);
    } else if (scrollColumnIntervalMs.value !== undefined) {
        parsed.scrollColumnIntervalMs = scrollColumnIntervalMs.value;
    }

    const dimmed = readOptionalBoolean(settings, "dimmed", rightMessagesLabel);
    if (dimmed.error !== undefined) {
        errors.push(dimmed.error);
    } else if (dimmed.value !== undefined) {
        parsed.dimmed = dimmed.value;
    }

    const italic = readOptionalBoolean(settings, "italic", rightMessagesLabel);
    if (italic.error !== undefined) {
        errors.push(italic.error);
    } else if (italic.value !== undefined) {
        parsed.italic = italic.value;
    }

    const messages = readOptionalMessages(settings, rightMessagesLabel);
    errors.push(...messages.errors);
    if (messages.value !== undefined) {
        parsed.messages = messages.value;
    }

    const messagesFile = readOptionalMessagesFile(settings, rightMessagesLabel, baseDir);
    if (messagesFile.error !== undefined) {
        errors.push(messagesFile.error);
    } else if (messagesFile.value !== undefined) {
        parsed.messagesFile = messagesFile.value;
    }

    return { settings: parsed, errors };
}

function parseRunTimerSettings(
    settings: unknown,
    label: string,
    baseDir: string,
): { settings: RunTimerSettings; errors: string[] } {
    if (!isRecord(settings)) {
        return { settings: {}, errors: [`${label} must be a JSON object.`] };
    }

    const rawRunTimer = settings[RUN_TIMER_SETTINGS_KEY];
    if (rawRunTimer === undefined) {
        return { settings: {}, errors: [] };
    }
    if (!isRecord(rawRunTimer)) {
        return {
            settings: {},
            errors: [`${label}.${RUN_TIMER_SETTINGS_KEY} must be a JSON object.`],
        };
    }

    const parsed = parseRightMessagesSettings(
        rawRunTimer[RIGHT_MESSAGES_SETTINGS_KEY],
        `${label}.${RUN_TIMER_SETTINGS_KEY}`,
        baseDir,
    );
    return {
        settings: { rightMessages: parsed.settings },
        errors: parsed.errors,
    };
}

function resolveConfiguredPath(path: string, baseDir: string): string {
    if (path === "~") {
        return homedir();
    }
    if (path.startsWith("~/")) {
        return join(homedir(), path.slice(2));
    }
    if (isAbsolute(path)) {
        return path;
    }
    return resolve(baseDir, path);
}

function parseMessagesFileContent(content: string): string[] {
    const messages: string[] = [];
    for (const line of content.split(/\r?\n/u)) {
        const message = line.trim();
        if (message.length === 0) {
            continue;
        }
        if (message.startsWith("#")) {
            continue;
        }
        messages.push(message);
    }
    return messages;
}

function readMessagesFile(reference: MessageFileReference): { messages: string[]; error?: string } {
    const resolvedPath = resolveConfiguredPath(reference.path, reference.baseDir);
    try {
        const content = readFileSync(resolvedPath, "utf8");
        return { messages: parseMessagesFileContent(content) };
    } catch (cause: unknown) {
        let message: string;
        if (cause instanceof Error) {
            message = cause.message;
        } else {
            message = String(cause);
        }
        return {
            messages: [],
            error: `Failed to read ${reference.label} (${resolvedPath}): ${message}`,
        };
    }
}

function buildRunTimerConfig(settings: RunTimerSettings): LoadedRunTimerConfig {
    const rightMessages = settings.rightMessages ?? {};
    const errors: string[] = [];
    const messages: string[] = [];

    if (rightMessages.enabled === false) {
        return {
            config: {
                rightMessages: {
                    enabled: false,
                    intervalMs:
                        rightMessages.intervalMs ?? DEFAULT_RIGHT_MESSAGES_CONFIG.intervalMs,
                    minGap: rightMessages.minGap ?? DEFAULT_RIGHT_MESSAGES_CONFIG.minGap,
                    minScrollCycles:
                        rightMessages.minScrollCycles ??
                        DEFAULT_RIGHT_MESSAGES_CONFIG.minScrollCycles,
                    scrollColumnIntervalMs:
                        rightMessages.scrollColumnIntervalMs ??
                        DEFAULT_RIGHT_MESSAGES_CONFIG.scrollColumnIntervalMs,
                    dimmed: rightMessages.dimmed ?? DEFAULT_RIGHT_MESSAGES_CONFIG.dimmed,
                    italic: rightMessages.italic ?? DEFAULT_RIGHT_MESSAGES_CONFIG.italic,
                    messages: [],
                },
            },
            errors,
        };
    }

    if (rightMessages.messages !== undefined) {
        messages.push(...rightMessages.messages);
    }

    if (rightMessages.messagesFile !== undefined) {
        const loaded = readMessagesFile(rightMessages.messagesFile);
        messages.push(...loaded.messages);
        if (loaded.error !== undefined) {
            errors.push(loaded.error);
        }
    }

    let enabled = messages.length > 0;
    if (rightMessages.enabled !== undefined) {
        enabled = rightMessages.enabled;
    }

    return {
        config: {
            rightMessages: {
                enabled,
                intervalMs: rightMessages.intervalMs ?? DEFAULT_RIGHT_MESSAGES_CONFIG.intervalMs,
                minGap: rightMessages.minGap ?? DEFAULT_RIGHT_MESSAGES_CONFIG.minGap,
                minScrollCycles:
                    rightMessages.minScrollCycles ?? DEFAULT_RIGHT_MESSAGES_CONFIG.minScrollCycles,
                scrollColumnIntervalMs:
                    rightMessages.scrollColumnIntervalMs ??
                    DEFAULT_RIGHT_MESSAGES_CONFIG.scrollColumnIntervalMs,
                dimmed: rightMessages.dimmed ?? DEFAULT_RIGHT_MESSAGES_CONFIG.dimmed,
                italic: rightMessages.italic ?? DEFAULT_RIGHT_MESSAGES_CONFIG.italic,
                messages,
            },
        },
        errors,
    };
}

/**
 * Resolves run timer settings from already-parsed Pi settings objects in precedence order.
 */
export function resolveRunTimerConfig(
    settingsSources: readonly RunTimerSettingsSource[],
): LoadedRunTimerConfig {
    let mergedSettings: RunTimerSettings = {};
    const errors: string[] = [];

    for (const source of settingsSources) {
        const parsed = parseRunTimerSettings(source.settings, source.label, source.baseDir);
        if (parsed.settings.rightMessages !== undefined) {
            mergedSettings = {
                ...mergedSettings,
                rightMessages: {
                    ...mergedSettings.rightMessages,
                    ...parsed.settings.rightMessages,
                },
            };
        }
        errors.push(...parsed.errors);
    }

    const loaded = buildRunTimerConfig(mergedSettings);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}

function readSettingsFile(path: string, label: string): { settings?: unknown; error?: string } {
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
 * Loads run timer settings from Pi global settings and trusted project settings.
 */
export function loadRunTimerConfig(cwd: string, projectTrusted: boolean): LoadedRunTimerConfig {
    const agentDir = getAgentDir();
    const globalSettingsPath = join(agentDir, "settings.json");
    const globalSettings = readSettingsFile(globalSettingsPath, globalSettingsPath);
    const settingsSources: RunTimerSettingsSource[] = [];
    const errors: string[] = [];

    if (globalSettings.settings !== undefined) {
        settingsSources.push({
            label: globalSettingsPath,
            baseDir: agentDir,
            settings: globalSettings.settings,
        });
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
                baseDir: cwd,
                settings: projectSettings.settings,
            });
        }
        if (projectSettings.error !== undefined) {
            errors.push(projectSettings.error);
        }
    }

    const loaded = resolveRunTimerConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}
