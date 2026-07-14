import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import { loadPiExtensionSettingsSync } from "@zigai/pi-extension-settings/pi";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

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
export const DEFAULT_URL_COLOR_SETTING = "#87d7ff";

export const themeForegroundColorSchema = Type.Union(
    THEME_FOREGROUND_COLORS.map((color) => Type.Literal(color)),
);
export const urlColorSettingSchema = Type.Union([
    Type.Integer({ minimum: 0, maximum: 255 }),
    Type.Literal(""),
    Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
    themeForegroundColorSchema,
]);

export const messageHighlightsSettingsDefinition = defineExtensionSettings({
    id: "pi-message-highlights",
    title: "Pi Message Highlights",
    description: "Settings for highlighting URLs in message output.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-message-highlights/config.schema.json",
    schema: Type.Object(
        {
            urlColor: Type.Union(urlColorSettingSchema.anyOf, {
                default: DEFAULT_URL_COLOR_SETTING,
                description:
                    "URL color as an ANSI-256 index, hex color, theme color name, or empty string to disable highlighting.",
            }),
        },
        { additionalProperties: false },
    ),
});

export default messageHighlightsSettingsDefinition;

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

type UrlColorSetting = Static<typeof urlColorSettingSchema>;
const MessageHighlightsConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        urlColor: Type.Optional(urlColorSettingSchema),
    },
    { additionalProperties: false },
);

const THEME_FOREGROUND_COLOR_SET = new Set<string>(THEME_FOREGROUND_COLORS);

export const DEFAULT_MESSAGE_HIGHLIGHTS_CONFIG: MessageHighlightsConfig = {
    urlColor: {
        kind: "hex",
        color: DEFAULT_URL_COLOR_SETTING,
    },
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
        Object.assign(mergedSettings, parsed.settings);
        errors.push(...parsed.errors);
    }

    return {
        config: buildMessageHighlightsConfig(mergedSettings),
        errors,
    };
}

export function loadMessageHighlightsSettings(
    cwd: string,
    projectTrusted: boolean,
): LoadedMessageHighlightsConfig {
    const settings = loadPiExtensionSettingsSync(
        messageHighlightsSettingsDefinition,
        { cwd, isProjectTrusted: () => projectTrusted },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
    const settingsSources: MessageHighlightsSettingsSource[] = [];
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

    const loaded = resolveMessageHighlightsConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...settings.diagnostics.map((diagnostic) => diagnostic.message), ...loaded.errors],
    };
}
