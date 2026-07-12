import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import { FOOTER_LAYOUT } from "./constants.ts";
import { FOOTER_CUSTOM_SLOT_ID_PATTERN, type FooterLayout, type FooterSlotId } from "./types.ts";

const EXTENSION_ID = "pi-footer";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";

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

const FooterBuiltinSlotIdSchema = Type.Union([
    Type.Literal("path"),
    Type.Literal("branch"),
    Type.Literal("provider"),
    Type.Literal("model"),
    Type.Literal("thinking"),
    Type.Literal("mcp"),
    Type.Literal("context"),
]);

const FooterCustomSlotIdSchema = Type.String({ pattern: FOOTER_CUSTOM_SLOT_ID_PATTERN });
const FooterSlotIdSchema = Type.Union([FooterBuiltinSlotIdSchema, FooterCustomSlotIdSchema]);

const FooterLayoutSchema = Type.Object(
    {
        left: Type.Optional(Type.Array(FooterSlotIdSchema, { uniqueItems: true })),
        right: Type.Optional(Type.Array(FooterSlotIdSchema, { uniqueItems: true })),
        hidden: Type.Optional(Type.Array(FooterSlotIdSchema, { uniqueItems: true })),
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

const DEFAULT_FOOTER_CONFIG_FILE: ParsedFooterConfig = {
    $schema: `./${SCHEMA_FILE}`,
    separator: DEFAULT_FOOTER_CONFIG.separator,
    layout: {
        left: [...DEFAULT_FOOTER_CONFIG.layout.left],
        right: [...DEFAULT_FOOTER_CONFIG.layout.right],
        hidden: [...DEFAULT_FOOTER_CONFIG.layout.hidden],
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
    writeIfMissing(globalConfigPath, `${JSON.stringify(DEFAULT_FOOTER_CONFIG_FILE, null, 2)}\n`);
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

export function loadFooterConfig(cwd: string, projectTrusted: boolean): LoadedFooterConfig {
    scaffoldGlobalConfig();
    const globalConfigPath = getGlobalConfigPath();
    const globalConfig = readConfigFile(globalConfigPath, globalConfigPath);
    const settingsSources: FooterSettingsSource[] = [];
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

    const loaded = resolveFooterConfig(settingsSources);
    return {
        config: loaded.config,
        errors: [...errors, ...loaded.errors],
    };
}
