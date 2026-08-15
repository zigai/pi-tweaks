import {
    CONFIG_DIR_NAME,
    getAgentDir,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import { loadPiExtensionSettings } from "@zigai/pi-extension-settings/pi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

export type MentionProjectSettings = {
    trigger: string;
    roots: string[];
    gitReposOnly: boolean;
    includeDotFolders: boolean;
    completionSuffix: string;
};

export const DEFAULT_MENTION_TRIGGER = "#";
export const DEFAULT_COMPLETION_SUFFIX = " ";
export const INCLUDE_NON_GIT_FLAG = "mention-project-include-non-git";
export const INCLUDE_DOT_FOLDERS_FLAG = "mention-project-include-dot-folders";

// Keep pre-extension-settings installs working without moving or overwriting user config.
const LEGACY_SETTINGS_FILE = "settings.json";

const legacyMentionProjectSettingsSchema = Type.Object(
    {
        mentionProjectTrigger: Type.Optional(Type.Unknown()),
        mentionProjectRoots: Type.Optional(Type.Unknown()),
        mentionProjectGitReposOnly: Type.Optional(Type.Unknown()),
        mentionProjectIncludeDotFolders: Type.Optional(Type.Unknown()),
        mentionProjectCompletionSuffix: Type.Optional(Type.Unknown()),
    },
    { additionalProperties: true },
);

const legacyTriggerSchema = Type.String({
    minLength: 1,
    maxLength: 1,
    pattern: "^[^/\\s]$",
});
const legacyRootsSchema = Type.Union([
    Type.String({ minLength: 1 }),
    Type.Array(Type.String({ minLength: 1 })),
]);
const legacyBooleanSchema = Type.Boolean();
const legacyCompletionSuffixSchema = Type.String();

type LegacyMentionProjectSettings = {
    readonly mentionProjectTrigger?: unknown;
    readonly mentionProjectRoots?: unknown;
    readonly mentionProjectGitReposOnly?: unknown;
    readonly mentionProjectIncludeDotFolders?: unknown;
    readonly mentionProjectCompletionSuffix?: unknown;
};

type SettingsLayer = Readonly<Record<string, unknown>> | undefined;

export const mentionProjectSettingsDefinition = defineExtensionSettings({
    id: "pi-mention-project",
    title: "Pi Mention Project",
    description: "Settings for project mentions and project discovery.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-mention-project/config.schema.json",
    schema: Type.Object(
        {
            trigger: Type.String({
                minLength: 1,
                maxLength: 1,
                pattern: "^[^/\\s]$",
                default: DEFAULT_MENTION_TRIGGER,
                description: "Single character that starts a project mention.",
            }),
            roots: Type.Union(
                [
                    Type.String({
                        title: "One directory",
                        minLength: 1,
                        "x-control": "path",
                        description: "One project root directory.",
                    }),
                    Type.Array(
                        Type.String({
                            minLength: 1,
                            "x-control": "path",
                            description: "Project root directory.",
                        }),
                        { title: "Directory list" },
                    ),
                ],
                {
                    default: [],
                    description: "Project root directory or directories searched for projects.",
                },
            ),
            gitReposOnly: Type.Boolean({
                default: true,
                description: "Include only directories containing Git repositories.",
            }),
            includeDotFolders: Type.Boolean({
                default: false,
                description: "Include project directories whose names start with a dot.",
            }),
            completionSuffix: Type.String({
                default: DEFAULT_COMPLETION_SUFFIX,
                description: "Text inserted after a completed project mention.",
            }),
        },
        { additionalProperties: false },
    ),
});

function readLegacySettings(filePath: string): LegacyMentionProjectSettings {
    try {
        const parsedJson: unknown = JSON.parse(readFileSync(filePath, "utf8"));
        if (!Value.Check(legacyMentionProjectSettingsSchema, parsedJson)) return {};
        return Value.Parse(legacyMentionProjectSettingsSchema, parsedJson);
    } catch {
        return {};
    }
}

function legacySettingsPaths(ctx: MentionProjectSettingsContext): string[] {
    const paths = [join(getAgentDir(), LEGACY_SETTINGS_FILE)];
    if (ctx.isProjectTrusted()) {
        paths.push(join(ctx.cwd, CONFIG_DIR_NAME, LEGACY_SETTINGS_FILE));
    }
    return paths;
}

function hasSetting(layer: SettingsLayer, key: string): boolean {
    return layer !== undefined && Object.prototype.hasOwnProperty.call(layer, key);
}

function isGeneratedDefaultLayer(layer: SettingsLayer): boolean {
    if (layer === undefined) return false;
    return (
        Object.keys(layer).length === 5 &&
        layer.trigger === DEFAULT_MENTION_TRIGGER &&
        Array.isArray(layer.roots) &&
        layer.roots.length === 0 &&
        layer.gitReposOnly === true &&
        layer.includeDotFolders === false &&
        layer.completionSuffix === DEFAULT_COMPLETION_SUFFIX
    );
}

type LoadedMentionProjectSettings = {
    readonly globalSettingsLayer: SettingsLayer;
    readonly projectSettingsLayer: SettingsLayer;
};

function hasExplicitExtensionSetting(loaded: LoadedMentionProjectSettings, key: string): boolean {
    if (hasSetting(loaded.projectSettingsLayer, key)) return true;
    if (isGeneratedDefaultLayer(loaded.globalSettingsLayer)) return false;
    return hasSetting(loaded.globalSettingsLayer, key);
}

function parseLegacyString(schema: TSchema, value: unknown): string | undefined {
    if (!Value.Check(schema, value)) return undefined;
    const parsed: unknown = Value.Parse(schema, value);
    if (typeof parsed !== "string") return undefined;
    return parsed;
}

function parseLegacyBoolean(value: unknown): boolean | undefined {
    if (!Value.Check(legacyBooleanSchema, value)) return undefined;
    const parsed: unknown = Value.Parse(legacyBooleanSchema, value);
    if (typeof parsed !== "boolean") return undefined;
    return parsed;
}

function parseLegacyRoots(value: unknown): string[] | undefined {
    if (!Value.Check(legacyRootsSchema, value)) return undefined;
    const parsed: unknown = Value.Parse(legacyRootsSchema, value);
    if (typeof parsed === "string") {
        const root = parsed.trim();
        if (root.length === 0) return undefined;
        return [root];
    }
    if (!Array.isArray(parsed)) return undefined;
    const roots: string[] = [];
    for (const root of parsed) {
        if (typeof root !== "string") return undefined;
        const trimmed = root.trim();
        if (trimmed.length > 0) roots.push(trimmed);
    }
    if (roots.length === 0 && parsed.length > 0) return undefined;
    return roots;
}

function loadLegacySettings(ctx: MentionProjectSettingsContext): LegacyMentionProjectSettings {
    const paths = legacySettingsPaths(ctx);
    const globalSettingsPath = paths[0];
    const projectSettingsPath = paths[1];
    let globalSettings: LegacyMentionProjectSettings = {};
    if (globalSettingsPath !== undefined) globalSettings = readLegacySettings(globalSettingsPath);
    let projectSettings: LegacyMentionProjectSettings = {};
    if (projectSettingsPath !== undefined) {
        projectSettings = readLegacySettings(projectSettingsPath);
    }
    return { ...globalSettings, ...projectSettings };
}

function applyLegacySettings(
    legacy: LegacyMentionProjectSettings,
    settings: MentionProjectSettings,
    loaded: LoadedMentionProjectSettings,
): void {
    if (!hasExplicitExtensionSetting(loaded, "trigger")) {
        const trigger = parseLegacyString(legacyTriggerSchema, legacy.mentionProjectTrigger);
        if (trigger !== undefined) settings.trigger = trigger;
    }
    if (!hasExplicitExtensionSetting(loaded, "roots")) {
        const roots = parseLegacyRoots(legacy.mentionProjectRoots);
        if (roots !== undefined) settings.roots = roots;
    }
    if (!hasExplicitExtensionSetting(loaded, "gitReposOnly")) {
        const gitReposOnly = parseLegacyBoolean(legacy.mentionProjectGitReposOnly);
        if (gitReposOnly !== undefined) settings.gitReposOnly = gitReposOnly;
    }
    if (!hasExplicitExtensionSetting(loaded, "includeDotFolders")) {
        const includeDotFolders = parseLegacyBoolean(legacy.mentionProjectIncludeDotFolders);
        if (includeDotFolders !== undefined) settings.includeDotFolders = includeDotFolders;
    }
    if (!hasExplicitExtensionSetting(loaded, "completionSuffix")) {
        const completionSuffix = parseLegacyString(
            legacyCompletionSuffixSchema,
            legacy.mentionProjectCompletionSuffix,
        );
        if (completionSuffix !== undefined) settings.completionSuffix = completionSuffix;
    }
}

export default mentionProjectSettingsDefinition;

export type MentionProjectSettingsContext = Pick<ExtensionContext, "cwd" | "isProjectTrusted">;

/** Load validated global and trusted-project project-mention settings. */
export function loadMentionProjectSettings(
    ctx: MentionProjectSettingsContext,
): MentionProjectSettings {
    const loaded = loadPiExtensionSettings(
        mentionProjectSettingsDefinition,
        {
            cwd: ctx.cwd,
            isProjectTrusted: () => ctx.isProjectTrusted(),
        },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
    let roots: string[];
    if (Array.isArray(loaded.settings.roots)) {
        roots = [...loaded.settings.roots];
    } else {
        roots = [loaded.settings.roots];
    }

    const settings: MentionProjectSettings = {
        trigger: loaded.settings.trigger,
        roots,
        gitReposOnly: loaded.settings.gitReposOnly,
        includeDotFolders: loaded.settings.includeDotFolders,
        completionSuffix: loaded.settings.completionSuffix,
    };
    applyLegacySettings(loadLegacySettings(ctx), settings, loaded);
    return settings;
}

export function applyMentionProjectCliFlags(
    settings: MentionProjectSettings,
    flags: { includeNonGit: unknown; includeDotFolders: unknown },
): MentionProjectSettings {
    const loaded = { ...settings };
    if (flags.includeNonGit === true) loaded.gitReposOnly = false;
    if (flags.includeDotFolders === true) loaded.includeDotFolders = true;
    return loaded;
}
