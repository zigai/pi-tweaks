import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import { loadPiExtensionSettings } from "@zigai/pi-extension-settings/pi";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { FOOTER_LAYOUT } from "./constants.ts";
import { FOOTER_CUSTOM_SLOT_ID_PATTERN, type FooterLayout, type FooterSlotId } from "./types.ts";

export type FooterConfig = {
    readonly separator: string;
    readonly layout: FooterLayout;
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
    $schema?: string;
    separator?: string;
    layout?: FooterLayoutSettings;
};

type FooterLayoutSettings = {
    left?: readonly FooterSlotId[];
    right?: readonly FooterSlotId[];
    hidden?: readonly FooterSlotId[];
};

const builtinSlotIdSchema = Type.Union([
    Type.Literal("path"),
    Type.Literal("branch"),
    Type.Literal("provider"),
    Type.Literal("model"),
    Type.Literal("thinking"),
    Type.Literal("mcp"),
    Type.Literal("context"),
]);
export const footerSlotIdSchema = Type.Union([
    builtinSlotIdSchema,
    Type.String({ pattern: FOOTER_CUSTOM_SLOT_ID_PATTERN }),
]);

export const footerSettingsDefinition = defineExtensionSettings({
    id: "pi-footer",
    title: "Pi Footer",
    description: "Settings for footer content, ordering, and separators.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-footer/config.schema.json",
    schema: Type.Object(
        {
            separator: Type.String({
                default: "·",
                description: "Text placed between visible footer slots.",
            }),
            layout: Type.Object(
                {
                    left: Type.Array(footerSlotIdSchema, {
                        uniqueItems: true,
                        default: [...FOOTER_LAYOUT.left],
                        description: "Footer slot IDs shown on the left in display order.",
                    }),
                    right: Type.Array(footerSlotIdSchema, {
                        uniqueItems: true,
                        default: [...FOOTER_LAYOUT.right],
                        description: "Footer slot IDs shown on the right in display order.",
                    }),
                    hidden: Type.Array(footerSlotIdSchema, {
                        uniqueItems: true,
                        default: [],
                        description: "Footer slot IDs hidden from both sides.",
                    }),
                },
                { default: {}, additionalProperties: false },
            ),
        },
        { additionalProperties: false },
    ),
});

export default footerSettingsDefinition;

const FooterLayoutSchema = Type.Object(
    {
        left: Type.Optional(Type.Array(footerSlotIdSchema, { uniqueItems: true })),
        right: Type.Optional(Type.Array(footerSlotIdSchema, { uniqueItems: true })),
        hidden: Type.Optional(Type.Array(footerSlotIdSchema, { uniqueItems: true })),
    },
    { additionalProperties: false },
);

const FooterConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        separator: Type.Optional(Type.String()),
        layout: Type.Optional(FooterLayoutSchema),
    },
    { additionalProperties: false },
);

type ParsedFooterConfig = Static<typeof FooterConfigSchema>;

const BUILTIN_FOOTER_SLOT_IDS = new Set([
    "path",
    "branch",
    "provider",
    "model",
    "thinking",
    "mcp",
    "context",
]);
const FOOTER_CUSTOM_SLOT_ID_REGEX = new RegExp(FOOTER_CUSTOM_SLOT_ID_PATTERN);

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
    separator: "·",
    layout: {
        left: [...FOOTER_LAYOUT.left],
        right: [...FOOTER_LAYOUT.right],
        hidden: [],
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

function sanitizeSeparator(value: string): string {
    return value
        .replace(/[\r\n\t]/g, " ")
        .replace(/ +/g, " ")
        .trim();
}

function cloneSlotIds(values: readonly FooterSlotId[]): FooterSlotId[] {
    return [...values];
}

function isFooterSlotId(value: string): value is FooterSlotId {
    return BUILTIN_FOOTER_SLOT_IDS.has(value) || FOOTER_CUSTOM_SLOT_ID_REGEX.test(value);
}

function parseSlotIds(values: readonly string[]): FooterSlotId[] {
    const slotIds: FooterSlotId[] = [];
    for (const value of values) {
        if (isFooterSlotId(value)) {
            slotIds.push(value);
        }
    }
    return slotIds;
}

function findSharedVisibleSlotId(
    left: readonly FooterSlotId[] | undefined,
    right: readonly FooterSlotId[] | undefined,
    hidden: readonly FooterSlotId[] | undefined,
): FooterSlotId | undefined {
    if (left === undefined || right === undefined) return undefined;

    const hiddenIds = new Set(hidden ?? []);
    const leftIds = new Set<FooterSlotId>();
    for (const slotId of left) {
        if (!hiddenIds.has(slotId)) {
            leftIds.add(slotId);
        }
    }

    for (const slotId of right) {
        if (hiddenIds.has(slotId)) continue;
        if (leftIds.has(slotId)) return slotId;
    }
    return undefined;
}

function parseFooterLayoutSettings(
    layout: NonNullable<ParsedFooterConfig["layout"]>,
    label: string,
): { layout?: FooterLayoutSettings; errors: string[] } {
    const settings: FooterLayoutSettings = {};

    if (layout.left !== undefined) {
        settings.left = parseSlotIds(layout.left);
    }
    if (layout.right !== undefined) {
        settings.right = parseSlotIds(layout.right);
    }
    if (layout.hidden !== undefined) {
        settings.hidden = parseSlotIds(layout.hidden);
    }

    const sharedSlotId = findSharedVisibleSlotId(settings.left, settings.right, settings.hidden);
    if (sharedSlotId !== undefined) {
        return {
            errors: [`${label}.layout cannot place "${sharedSlotId}" on both left and right.`],
        };
    }

    return { layout: settings, errors: [] };
}

function parseFooterSettings(
    settings: unknown,
    label: string,
): { settings: FooterSettings; errors: string[] } {
    let parsed: ParsedFooterConfig;
    try {
        parsed = parseSchema(FooterConfigSchema, settings, label);
    } catch (error: unknown) {
        let message: string;
        if (error instanceof Error) {
            message = error.message;
        } else {
            message = String(error);
        }
        return { settings: {}, errors: [message] };
    }

    if (parsed.separator === undefined) {
        if (parsed.layout === undefined) {
            return { settings: {}, errors: [] };
        }
    }

    const nextSettings: FooterSettings = {};
    const errors: string[] = [];

    if (parsed.separator !== undefined) {
        const sanitized = sanitizeSeparator(parsed.separator);
        if (sanitized.length === 0) {
            errors.push(`${label}.separator must contain a visible character.`);
        } else {
            nextSettings.separator = sanitized;
        }
    }

    if (parsed.layout !== undefined) {
        const parsedLayout = parseFooterLayoutSettings(parsed.layout, label);
        if (parsedLayout.layout !== undefined) {
            nextSettings.layout = parsedLayout.layout;
        }
        errors.push(...parsedLayout.errors);
    }

    return { settings: nextSettings, errors };
}

function buildFooterConfig(settings: FooterSettings): FooterConfig {
    return {
        separator: settings.separator ?? DEFAULT_FOOTER_CONFIG.separator,
        layout: {
            left: cloneSlotIds(settings.layout?.left ?? DEFAULT_FOOTER_CONFIG.layout.left),
            right: cloneSlotIds(settings.layout?.right ?? DEFAULT_FOOTER_CONFIG.layout.right),
            hidden: cloneSlotIds(settings.layout?.hidden ?? DEFAULT_FOOTER_CONFIG.layout.hidden),
        },
    };
}

function buildDefaultFooterLayout(): FooterLayout {
    return {
        left: cloneSlotIds(DEFAULT_FOOTER_CONFIG.layout.left),
        right: cloneSlotIds(DEFAULT_FOOTER_CONFIG.layout.right),
        hidden: cloneSlotIds(DEFAULT_FOOTER_CONFIG.layout.hidden),
    };
}

function getFooterLayoutError(layout: FooterLayout): string | undefined {
    const sharedSlotId = findSharedVisibleSlotId(layout.left, layout.right, layout.hidden);
    if (sharedSlotId === undefined) return undefined;
    return `footer layout cannot place "${sharedSlotId}" on both left and right.`;
}

function mergeFooterSettings(current: FooterSettings, next: FooterSettings): FooterSettings {
    const merged: FooterSettings = { ...current, ...next };
    if (current.layout === undefined && next.layout === undefined) {
        return merged;
    }

    merged.layout = { ...current.layout, ...next.layout };
    return merged;
}

export function resolveFooterConfig(
    settingsSources: readonly FooterSettingsSource[],
): LoadedFooterConfig {
    let mergedSettings: FooterSettings = {};
    const errors: string[] = [];

    for (const source of settingsSources) {
        const parsed = parseFooterSettings(source.settings, source.label);
        mergedSettings = mergeFooterSettings(mergedSettings, parsed.settings);
        errors.push(...parsed.errors);
    }

    const config = buildFooterConfig(mergedSettings);
    const layoutError = getFooterLayoutError(config.layout);
    if (layoutError !== undefined) {
        return {
            config: {
                separator: config.separator,
                layout: buildDefaultFooterLayout(),
            },
            errors: [...errors, layoutError],
        };
    }

    return { config, errors };
}

export function loadFooterSettings(cwd: string, projectTrusted: boolean): LoadedFooterConfig {
    const settings = loadPiExtensionSettings(
        footerSettingsDefinition,
        { cwd, isProjectTrusted: () => projectTrusted },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
    const settingsSources: FooterSettingsSource[] = [];
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

    const loaded = resolveFooterConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...settings.diagnostics.map((diagnostic) => diagnostic.message), ...loaded.errors],
    };
}
