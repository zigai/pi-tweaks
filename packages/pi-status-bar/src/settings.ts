import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { StatusBarConfig } from "./status-bar-api.ts";

const EXTENSION_ID = "pi-status-bar";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";
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

export type StatusBarResolvedConfig = {
    readonly statusBar: StatusBarConfig;
    readonly rightMessages: RightMessagesConfig;
};

export type LoadedStatusBarConfig = {
    readonly config: StatusBarResolvedConfig;
    readonly errors: readonly string[];
};

export type StatusBarSettingsSource = {
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

type StatusBarSettings = {
    readonly $schema?: string;
    readonly statusBar?: StatusBarConfig;
    readonly rightMessages?: RightMessagesSettings;
};

type MutableStatusBarConfig = {
    active?: {
        text?: string;
        spinner?: {
            frames?: readonly string[];
        };
        timer?: {
            visible?: boolean;
            paused?: boolean;
        };
    };
    idle?: {
        text?: string;
        visible?: boolean;
        showLastRunSummary?: boolean;
    };
};

const StatusBarSpinnerConfigSchema = Type.Object(
    {
        frames: Type.Optional(Type.Array(Type.String())),
    },
    { additionalProperties: false },
);

const StatusBarTimerConfigSchema = Type.Object(
    {
        visible: Type.Optional(Type.Boolean()),
        paused: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);

const StatusBarActiveConfigSchema = Type.Object(
    {
        text: Type.Optional(Type.String()),
        spinner: Type.Optional(StatusBarSpinnerConfigSchema),
        timer: Type.Optional(StatusBarTimerConfigSchema),
    },
    { additionalProperties: false },
);

const StatusBarIdleConfigSchema = Type.Object(
    {
        text: Type.Optional(Type.String()),
        visible: Type.Optional(Type.Boolean()),
        showLastRunSummary: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
);

const StatusBarConfigSchema = Type.Object(
    {
        active: Type.Optional(StatusBarActiveConfigSchema),
        idle: Type.Optional(StatusBarIdleConfigSchema),
    },
    { additionalProperties: false },
);

const RightMessagesConfigSchema = Type.Object(
    {
        enabled: Type.Optional(Type.Boolean()),
        intervalMs: Type.Optional(Type.Integer({ minimum: 1 })),
        minGap: Type.Optional(Type.Integer({ minimum: 0 })),
        minScrollCycles: Type.Optional(Type.Integer({ minimum: 1 })),
        scrollColumnIntervalMs: Type.Optional(Type.Integer({ minimum: 1 })),
        dimmed: Type.Optional(Type.Boolean()),
        italic: Type.Optional(Type.Boolean()),
        messages: Type.Optional(Type.Array(Type.String())),
        messagesFile: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
);

const StatusBarConfigFileSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        statusBar: Type.Optional(StatusBarConfigSchema),
        rightMessages: Type.Optional(RightMessagesConfigSchema),
    },
    { additionalProperties: false },
);

type ParsedStatusBarResolvedConfig = Static<typeof StatusBarConfigFileSchema>;

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

export const DEFAULT_STATUS_BAR_CONFIG: StatusBarConfig = {
    active: {
        timer: {
            visible: true,
            paused: false,
        },
    },
    idle: {
        visible: true,
        showLastRunSummary: true,
    },
};

const DEFAULT_STATUS_BAR_CONFIG_FILE: ParsedStatusBarResolvedConfig = {
    $schema: `./${SCHEMA_FILE}`,
    statusBar: {
        active: {
            timer: {
                visible: true,
                paused: false,
            },
        },
        idle: {
            visible: true,
            showLastRunSummary: true,
        },
    },
    rightMessages: {
        enabled: DEFAULT_RIGHT_MESSAGES_CONFIG.enabled,
        intervalMs: DEFAULT_RIGHT_MESSAGES_CONFIG.intervalMs,
        minGap: DEFAULT_RIGHT_MESSAGES_CONFIG.minGap,
        minScrollCycles: DEFAULT_RIGHT_MESSAGES_CONFIG.minScrollCycles,
        scrollColumnIntervalMs: DEFAULT_RIGHT_MESSAGES_CONFIG.scrollColumnIntervalMs,
        dimmed: DEFAULT_RIGHT_MESSAGES_CONFIG.dimmed,
        italic: DEFAULT_RIGHT_MESSAGES_CONFIG.italic,
        messages: [],
    },
};

function sanitizeOptionalText(text: string | undefined): string | undefined {
    if (text === undefined) return undefined;
    const sanitized = text
        .replace(/[\r\n\t]/g, " ")
        .replace(/ +/g, " ")
        .trim();
    if (sanitized.length === 0) return undefined;
    return sanitized;
}

function sanitizeOptionalFrames(
    frames: readonly string[] | undefined,
): readonly string[] | undefined {
    if (frames === undefined) return undefined;

    const sanitizedFrames: string[] = [];
    for (const frame of frames) {
        const sanitized = sanitizeOptionalText(frame);
        if (sanitized !== undefined) {
            sanitizedFrames.push(sanitized);
        }
    }

    if (sanitizedFrames.length === 0) return undefined;
    return sanitizedFrames;
}

function parseStatusBarConfigSettings(
    settings: Static<typeof StatusBarConfigSchema> | undefined,
): StatusBarConfig | undefined {
    if (settings === undefined) return undefined;

    const parsed = settings;
    const statusBar: MutableStatusBarConfig = {};

    if (parsed.active !== undefined) {
        const active: NonNullable<MutableStatusBarConfig["active"]> = {};
        const text = sanitizeOptionalText(parsed.active.text);
        if (text !== undefined) {
            active.text = text;
        }
        const frames = sanitizeOptionalFrames(parsed.active.spinner?.frames);
        if (frames !== undefined) {
            active.spinner = { frames };
        }
        if (parsed.active.timer !== undefined) {
            active.timer = parsed.active.timer;
        }
        statusBar.active = active;
    }

    if (parsed.idle !== undefined) {
        const idle: NonNullable<MutableStatusBarConfig["idle"]> = {};
        const text = sanitizeOptionalText(parsed.idle.text);
        if (text !== undefined) {
            idle.text = text;
        }
        if (parsed.idle.visible !== undefined) {
            idle.visible = parsed.idle.visible;
        }
        if (parsed.idle.showLastRunSummary !== undefined) {
            idle.showLastRunSummary = parsed.idle.showLastRunSummary;
        }
        statusBar.idle = idle;
    }

    return statusBar;
}

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

function parseStatusBarSettings(
    settings: unknown,
    label: string,
    baseDir: string,
): { settings: StatusBarSettings; errors: string[] } {
    let parsedConfig: ParsedStatusBarResolvedConfig;
    try {
        parsedConfig = parseSchema(StatusBarConfigFileSchema, settings, label);
    } catch (error: unknown) {
        let message: string;
        if (error instanceof Error) {
            message = error.message;
        } else {
            message = String(error);
        }
        return { settings: {}, errors: [message] };
    }

    const parsed = parseRightMessagesSettings(parsedConfig.rightMessages, label, baseDir);
    return {
        settings: {
            statusBar: parseStatusBarConfigSettings(parsedConfig.statusBar),
            rightMessages: parsed.settings,
        },
        errors: parsed.errors,
    };
}

function mergeStatusBarConfig(
    current: StatusBarConfig | undefined,
    next: StatusBarConfig | undefined,
): StatusBarConfig | undefined {
    if (current === undefined) return next;
    if (next === undefined) return current;

    return {
        active: {
            ...current.active,
            ...next.active,
            spinner: {
                ...current.active?.spinner,
                ...next.active?.spinner,
            },
            timer: {
                ...current.active?.timer,
                ...next.active?.timer,
            },
        },
        idle: {
            ...current.idle,
            ...next.idle,
        },
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

function buildStatusBarResolvedConfig(settings: StatusBarSettings): LoadedStatusBarConfig {
    const rightMessages = settings.rightMessages ?? {};
    const errors: string[] = [];
    const messages: string[] = [];

    if (rightMessages.enabled === false) {
        return {
            config: {
                statusBar: settings.statusBar ?? DEFAULT_STATUS_BAR_CONFIG,
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
            statusBar: settings.statusBar ?? DEFAULT_STATUS_BAR_CONFIG,
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
 * Resolves status bar settings from already-parsed Pi settings objects in precedence order.
 */
export function resolveStatusBarResolvedConfig(
    settingsSources: readonly StatusBarSettingsSource[],
): LoadedStatusBarConfig {
    let mergedSettings: StatusBarSettings = {};
    const errors: string[] = [];

    for (const source of settingsSources) {
        const parsed = parseStatusBarSettings(source.settings, source.label, source.baseDir);
        mergedSettings = {
            ...mergedSettings,
            statusBar: mergeStatusBarConfig(mergedSettings.statusBar, parsed.settings.statusBar),
        };
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

    const loaded = buildStatusBarResolvedConfig(mergedSettings);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}

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
    writeIfMissing(
        globalConfigPath,
        `${JSON.stringify(DEFAULT_STATUS_BAR_CONFIG_FILE, null, 2)}\n`,
    );
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
 * Loads status bar settings from extension global config and trusted project config.
 */
export function loadStatusBarResolvedConfig(
    cwd: string,
    projectTrusted: boolean,
): LoadedStatusBarConfig {
    scaffoldGlobalConfig();
    const globalConfigPath = getGlobalConfigPath();
    const globalConfig = readConfigFile(globalConfigPath, globalConfigPath);
    const settingsSources: StatusBarSettingsSource[] = [];
    const errors: string[] = [];

    if (globalConfig.settings !== undefined) {
        settingsSources.push({
            label: globalConfigPath,
            baseDir: dirname(globalConfigPath),
            settings: globalConfig.settings,
        });
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
                baseDir: cwd,
                settings: projectConfig.settings,
            });
        }
        if (projectConfig.error !== undefined) {
            errors.push(projectConfig.error);
        }
    }

    const loaded = resolveStatusBarResolvedConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}
