import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const EXTENSION_ID = "pi-message-highlights";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";

export const THEME_FOREGROUND_COLORS = [
    "accent",
    "border",
    "borderAccent",
    "borderMuted",
    "success",
    "error",
    "warning",
    "muted",
    "dim",
    "text",
    "thinkingText",
    "userMessageText",
    "customMessageText",
    "customMessageLabel",
    "toolTitle",
    "toolOutput",
    "mdHeading",
    "mdLink",
    "mdLinkUrl",
    "mdCode",
    "mdCodeBlock",
    "mdCodeBlockBorder",
    "mdQuote",
    "mdQuoteBorder",
    "mdHr",
    "mdListBullet",
    "toolDiffAdded",
    "toolDiffRemoved",
    "toolDiffContext",
    "syntaxComment",
    "syntaxKeyword",
    "syntaxFunction",
    "syntaxVariable",
    "syntaxString",
    "syntaxNumber",
    "syntaxType",
    "syntaxOperator",
    "syntaxPunctuation",
    "thinkingOff",
    "thinkingMinimal",
    "thinkingLow",
    "thinkingMedium",
    "thinkingHigh",
    "thinkingXhigh",
    "bashMode",
] as const;

export type ThemeForegroundColor = (typeof THEME_FOREGROUND_COLORS)[number];

export type HighlightColor =
    | {
          readonly kind: "none";
      }
    | {
          readonly kind: "theme";
          readonly color: ThemeForegroundColor;
      }
    | {
          readonly kind: "ansi256";
          readonly color: number;
      }
    | {
          readonly kind: "hex";
          readonly color: `#${string}`;
      };

export type MessageHighlightsConfig = {
    readonly urlColor: HighlightColor;
};

export type LoadedMessageHighlightsConfig = {
    readonly config: MessageHighlightsConfig;
    readonly errors: readonly string[];
};

export type MessageHighlightsSettingsSource = {
    readonly label: string;
    readonly settings: unknown;
};

type MessageHighlightsSettings = {
    readonly $schema?: string;
    readonly urlColor?: UrlColorSetting;
};

type UrlColorSetting = Static<typeof UrlColorSettingSchema>;

const ThemeForegroundColorSchema = Type.Union(
    THEME_FOREGROUND_COLORS.map((color) => Type.Literal(color)),
);
const HexColorSchema = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });
const UrlColorSettingSchema = Type.Union([
    Type.Integer({ minimum: 0, maximum: 255 }),
    Type.Literal(""),
    HexColorSchema,
    ThemeForegroundColorSchema,
]);
const MessageHighlightsConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        urlColor: Type.Optional(UrlColorSettingSchema),
    },
    { additionalProperties: false },
);

type ParsedMessageHighlightsConfig = Static<typeof MessageHighlightsConfigSchema>;
const THEME_FOREGROUND_COLOR_SET = new Set<string>(THEME_FOREGROUND_COLORS);

export const DEFAULT_URL_COLOR_SETTING = 117;

export const DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG: MessageHighlightsConfig = {
    urlColor: {
        kind: "ansi256",
        color: DEFAULT_URL_COLOR_SETTING,
    },
};

const DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG_FILE: ParsedMessageHighlightsConfig = {
    $schema: `./${SCHEMA_FILE}`,
    urlColor: DEFAULT_URL_COLOR_SETTING,
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
            .slice(0, 5)
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

function parseMessageHighlightsSettings(
    settings: unknown,
    label: string,
): { settings: MessageHighlightsSettings; errors: string[] } {
    try {
        const parsed = parseSchema(MessageHighlightsConfigSchema, settings, label);
        return { settings: parsed, errors: [] };
    } catch (cause: unknown) {
        let message: string;
        if (cause instanceof Error) {
            message = cause.message;
        } else {
            message = String(cause);
        }
        return { settings: {}, errors: [message] };
    }
}

function isHexColor(value: string): value is `#${string}` {
    return /^#[0-9a-fA-F]{6}$/.test(value);
}

function isThemeForegroundColor(value: string): value is ThemeForegroundColor {
    return THEME_FOREGROUND_COLOR_SET.has(value);
}

function parseUrlColorSetting(setting: UrlColorSetting): HighlightColor {
    if (typeof setting === "number") {
        return { kind: "ansi256", color: setting };
    }
    if (setting === "") {
        return { kind: "none" };
    }
    if (isHexColor(setting)) {
        return { kind: "hex", color: setting };
    }
    if (isThemeForegroundColor(setting)) {
        return { kind: "theme", color: setting };
    }
    throw new Error(`Invalid parsed URL color: ${setting}`);
}

function buildMessageHighlightsConfig(
    settings: MessageHighlightsSettings,
): MessageHighlightsConfig {
    if (settings.urlColor === undefined) return DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG;
    return {
        urlColor: parseUrlColorSetting(settings.urlColor),
    };
}

export function resolveMessageHighlightsConfig(
    settingsSources: readonly MessageHighlightsSettingsSource[],
): LoadedMessageHighlightsConfig {
    let mergedSettings: MessageHighlightsSettings = {};
    const errors: string[] = [];

    for (const source of settingsSources) {
        const parsed = parseMessageHighlightsSettings(source.settings, source.label);
        mergedSettings = { ...mergedSettings, ...parsed.settings };
        errors.push(...parsed.errors);
    }

    return {
        config: buildMessageHighlightsConfig(mergedSettings),
        errors,
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
    } catch (cause: unknown) {
        if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === "EEXIST") return;
        if (cause instanceof Error) throw cause;
        throw new Error(String(cause));
    }
}

function refreshSchemaFile(filePath: string, content: string): void {
    let temporaryPath: string | undefined;
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        try {
            if (readFileSync(filePath, "utf8") === content) return;
        } catch (cause: unknown) {
            if (!(cause instanceof Error) || (cause as NodeJS.ErrnoException).code !== "ENOENT") {
                throw cause;
            }
        }

        const nextTemporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        writeFileSync(nextTemporaryPath, content, { encoding: "utf8", flag: "wx" });
        temporaryPath = nextTemporaryPath;
        renameSync(temporaryPath, filePath);
        temporaryPath = undefined;
    } catch (cause: unknown) {
        if (temporaryPath !== undefined) {
            try {
                unlinkSync(temporaryPath);
            } catch {
                // Ignore cleanup failure while reporting the original scaffold failure.
            }
        }
        if (cause instanceof Error) throw cause;
        throw new Error(String(cause));
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
        `${JSON.stringify(DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG_FILE, null, 2)}\n`,
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

export function loadMessageHighlightsConfig(
    cwd: string,
    projectTrusted: boolean,
): LoadedMessageHighlightsConfig {
    scaffoldGlobalConfig();
    const globalConfigPath = getGlobalConfigPath();
    const globalConfig = readConfigFile(globalConfigPath, globalConfigPath);
    const settingsSources: MessageHighlightsSettingsSource[] = [];
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
            settingsSources.push({ label: projectConfigPath, settings: projectConfig.settings });
        }
        if (projectConfig.error !== undefined) {
            errors.push(projectConfig.error);
        }
    }

    const loaded = resolveMessageHighlightsConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}
