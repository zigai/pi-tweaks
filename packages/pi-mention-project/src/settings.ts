import {
    CONFIG_DIR_NAME,
    getAgentDir,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { MentionProjectSettings } from "./types.ts";

export const DEFAULT_MENTION_TRIGGER = "#";
export const DEFAULT_COMPLETION_SUFFIX = " ";
export const INCLUDE_NON_GIT_FLAG = "mention-project-include-non-git";
export const INCLUDE_DOT_FOLDERS_FLAG = "mention-project-include-dot-folders";

const EXTENSION_ID = "pi-mention-project";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";
const TRIGGER_SETTINGS_KEY = "trigger";
const ROOTS_SETTINGS_KEY = "roots";
const GIT_REPOS_ONLY_SETTINGS_KEY = "gitReposOnly";
const INCLUDE_DOT_FOLDERS_SETTINGS_KEY = "includeDotFolders";
const COMPLETION_SUFFIX_SETTINGS_KEY = "completionSuffix";

const MentionTriggerSchema = Type.String({ minLength: 1, maxLength: 1, pattern: "^[^/\\s]$" });
const ProjectRootsSchema = Type.Union([
    Type.String({ minLength: 1 }),
    Type.Array(Type.String({ minLength: 1 })),
]);
const BooleanSchema = Type.Boolean();
const CompletionSuffixSchema = Type.String();

const MentionProjectConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        [TRIGGER_SETTINGS_KEY]: Type.Optional(MentionTriggerSchema),
        [ROOTS_SETTINGS_KEY]: Type.Optional(ProjectRootsSchema),
        [GIT_REPOS_ONLY_SETTINGS_KEY]: Type.Optional(BooleanSchema),
        [INCLUDE_DOT_FOLDERS_SETTINGS_KEY]: Type.Optional(BooleanSchema),
        [COMPLETION_SUFFIX_SETTINGS_KEY]: Type.Optional(CompletionSuffixSchema),
    },
    { additionalProperties: false },
);

type ParsedMentionProjectConfig = Static<typeof MentionProjectConfigSchema>;

const DEFAULT_MENTION_PROJECT_CONFIG_FILE = {
    $schema: `./${SCHEMA_FILE}`,
    [TRIGGER_SETTINGS_KEY]: DEFAULT_MENTION_TRIGGER,
    [ROOTS_SETTINGS_KEY]: [],
    [GIT_REPOS_ONLY_SETTINGS_KEY]: true,
    [INCLUDE_DOT_FOLDERS_SETTINGS_KEY]: false,
    [COMPLETION_SUFFIX_SETTINGS_KEY]: DEFAULT_COMPLETION_SUFFIX,
};

type FileSignature = string | null;

type GlobalConfigScaffold = {
    configSignature: FileSignature;
    schemaSignature: FileSignature;
};

type CachedMentionProjectSettings = {
    cwd: string;
    projectTrusted: boolean;
    globalConfigSignature: FileSignature;
    projectConfigSignature: FileSignature;
    settings: MentionProjectSettings;
};

let globalConfigScaffold: GlobalConfigScaffold | undefined;
let cachedMentionProjectSettings: CachedMentionProjectSettings | undefined;

type ProjectTrustContext = ExtensionContext & {
    isProjectTrusted?: () => boolean;
};

function isProjectTrusted(ctx: ExtensionContext): boolean {
    return (ctx as ProjectTrustContext).isProjectTrusted?.() ?? true;
}

function parseOptionalString(schema: TSchema, value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (!Value.Check(schema, value)) return undefined;
    const parsed: unknown = Value.Parse(schema, value);
    if (typeof parsed === "string") return parsed;
    return undefined;
}

function parseOptionalBoolean(schema: TSchema, value: unknown): boolean | undefined {
    if (value === undefined) return undefined;
    if (!Value.Check(schema, value)) return undefined;
    const parsed: unknown = Value.Parse(schema, value);
    if (typeof parsed === "boolean") return parsed;
    return undefined;
}

function parseOptionalRoots(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;

    if (!Value.Check(ProjectRootsSchema, value)) return undefined;
    const parsed: unknown = Value.Parse(ProjectRootsSchema, value);
    if (typeof parsed === "string") {
        const trimmed = parsed.trim();
        if (trimmed.length === 0) return undefined;
        return [trimmed];
    }
    if (!Array.isArray(parsed)) return undefined;

    const roots = parsed.filter((entry): entry is string => {
        return typeof entry === "string" && entry.trim().length > 0;
    });
    if (roots.length === 0 && parsed.length > 0) return undefined;
    return roots;
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

function getFileSignature(filePath: string | undefined): FileSignature {
    if (filePath === undefined) return null;
    try {
        const stats = statSync(filePath, { bigint: true });
        return `${stats.mtimeNs.toString()}:${stats.size.toString()}`;
    } catch {
        return null;
    }
}

function getGlobalConfigScaffold(): GlobalConfigScaffold {
    const globalConfigPath = getGlobalConfigPath();
    return {
        configSignature: getFileSignature(globalConfigPath),
        schemaSignature: getFileSignature(getSchemaPath(globalConfigPath)),
    };
}

function cloneMentionProjectSettings(settings: MentionProjectSettings): MentionProjectSettings {
    return {
        ...settings,
        roots: [...settings.roots],
    };
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
        `${JSON.stringify(DEFAULT_MENTION_PROJECT_CONFIG_FILE, null, 2)}\n`,
    );
}

function ensureGlobalConfigScaffolded(): void {
    const current = getGlobalConfigScaffold();
    if (
        globalConfigScaffold?.configSignature === current.configSignature &&
        globalConfigScaffold.schemaSignature === current.schemaSignature &&
        current.configSignature !== null &&
        current.schemaSignature !== null
    ) {
        return;
    }

    scaffoldGlobalConfig();
    globalConfigScaffold = getGlobalConfigScaffold();
}

function readConfigFile(configPath: string): ParsedMentionProjectConfig {
    try {
        const raw = readFileSync(configPath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        if (!Value.Check(MentionProjectConfigSchema, parsedJson)) return {};
        return Value.Parse(MentionProjectConfigSchema, parsedJson);
    } catch {
        return {};
    }
}

function applyMentionProjectSettings(
    settings: Record<string, unknown>,
    target: MentionProjectSettings,
): void {
    const trigger = parseOptionalString(MentionTriggerSchema, settings[TRIGGER_SETTINGS_KEY]);
    if (trigger !== undefined) {
        target.trigger = trigger;
    }

    const roots = parseOptionalRoots(settings[ROOTS_SETTINGS_KEY]);
    if (roots !== undefined) {
        target.roots = roots;
    }

    const gitReposOnly = parseOptionalBoolean(BooleanSchema, settings[GIT_REPOS_ONLY_SETTINGS_KEY]);
    if (gitReposOnly !== undefined) {
        target.gitReposOnly = gitReposOnly;
    }

    const includeDotFolders = parseOptionalBoolean(
        BooleanSchema,
        settings[INCLUDE_DOT_FOLDERS_SETTINGS_KEY],
    );
    if (includeDotFolders !== undefined) {
        target.includeDotFolders = includeDotFolders;
    }

    const completionSuffix = parseOptionalString(
        CompletionSuffixSchema,
        settings[COMPLETION_SUFFIX_SETTINGS_KEY],
    );
    if (completionSuffix !== undefined) {
        target.completionSuffix = completionSuffix;
    }
}

export function configuredMentionProjectSettings(ctx: ExtensionContext): MentionProjectSettings {
    ensureGlobalConfigScaffolded();

    const projectTrusted = isProjectTrusted(ctx);
    const globalConfigPath = getGlobalConfigPath();
    let projectConfigPath: string | undefined;
    if (projectTrusted) {
        projectConfigPath = getProjectConfigPath(ctx.cwd);
    }
    const globalConfigSignature = getFileSignature(globalConfigPath);
    const projectConfigSignature = getFileSignature(projectConfigPath);

    if (
        cachedMentionProjectSettings?.cwd === ctx.cwd &&
        cachedMentionProjectSettings.projectTrusted === projectTrusted &&
        cachedMentionProjectSettings.globalConfigSignature === globalConfigSignature &&
        cachedMentionProjectSettings.projectConfigSignature === projectConfigSignature
    ) {
        return cloneMentionProjectSettings(cachedMentionProjectSettings.settings);
    }

    const loaded: MentionProjectSettings = {
        trigger: DEFAULT_MENTION_TRIGGER,
        roots: [],
        gitReposOnly: true,
        includeDotFolders: false,
        completionSuffix: DEFAULT_COMPLETION_SUFFIX,
    };

    applyMentionProjectSettings(readConfigFile(globalConfigPath), loaded);
    if (projectConfigPath !== undefined) {
        applyMentionProjectSettings(readConfigFile(projectConfigPath), loaded);
    }

    cachedMentionProjectSettings = {
        cwd: ctx.cwd,
        projectTrusted,
        globalConfigSignature,
        projectConfigSignature,
        settings: cloneMentionProjectSettings(loaded),
    };
    return loaded;
}

export function applyMentionProjectCliFlags(
    settings: MentionProjectSettings,
    flags: { includeNonGit: unknown; includeDotFolders: unknown },
): MentionProjectSettings {
    const loaded = { ...settings };
    if (flags.includeNonGit === true) {
        loaded.gitReposOnly = false;
    }
    if (flags.includeDotFolders === true) {
        loaded.includeDotFolders = true;
    }
    return loaded;
}
