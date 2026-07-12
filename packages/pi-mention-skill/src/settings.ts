import {
    CONFIG_DIR_NAME,
    getAgentDir,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { MentionSkillSettings } from "./types.ts";

export const DEFAULT_MENTION_TRIGGER = "$";
export const DEFAULT_COMPLETION_SUFFIX = " ";
const EXTENSION_ID = "pi-mention-skill";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";
const TRIGGER_SETTINGS_KEY = "trigger";
const HIDE_SLASH_SKILLS_SETTINGS_KEY = "hideSlashSkills";
const COMPLETION_SUFFIX_SETTINGS_KEY = "completionSuffix";

const MentionTriggerSchema = Type.String({ minLength: 1, maxLength: 1, pattern: "^[^/\\s]$" });
const HideSlashSkillsSchema = Type.Boolean();
const CompletionSuffixSchema = Type.String();

const MentionSkillConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        [TRIGGER_SETTINGS_KEY]: Type.Optional(MentionTriggerSchema),
        [HIDE_SLASH_SKILLS_SETTINGS_KEY]: Type.Optional(HideSlashSkillsSchema),
        [COMPLETION_SUFFIX_SETTINGS_KEY]: Type.Optional(CompletionSuffixSchema),
    },
    { additionalProperties: false },
);

type ParsedMentionSkillConfig = Static<typeof MentionSkillConfigSchema>;

const DEFAULT_MENTION_SKILL_CONFIG_FILE = {
    $schema: `./${SCHEMA_FILE}`,
    [TRIGGER_SETTINGS_KEY]: DEFAULT_MENTION_TRIGGER,
    [HIDE_SLASH_SKILLS_SETTINGS_KEY]: true,
    [COMPLETION_SUFFIX_SETTINGS_KEY]: DEFAULT_COMPLETION_SUFFIX,
};

type FileSignature = string | null;

type GlobalConfigScaffold = {
    configSignature: FileSignature;
    schemaSignature: FileSignature;
};

type CachedMentionSkillSettings = {
    cwd: string;
    projectTrusted: boolean;
    globalConfigSignature: FileSignature;
    projectConfigSignature: FileSignature;
    settings: MentionSkillSettings;
};

let globalConfigScaffold: GlobalConfigScaffold | undefined;
let cachedMentionSkillSettings: CachedMentionSkillSettings | undefined;

export type MentionSkillSettingsContext = Pick<ExtensionContext, "cwd"> & {
    isProjectTrusted?: () => boolean;
};

function isProjectTrusted(ctx: MentionSkillSettingsContext): boolean {
    return ctx.isProjectTrusted?.() ?? true;
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

function cloneMentionSkillSettings(settings: MentionSkillSettings): MentionSkillSettings {
    return { ...settings };
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
        `${JSON.stringify(DEFAULT_MENTION_SKILL_CONFIG_FILE, null, 2)}\n`,
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

function readConfigFile(configPath: string): ParsedMentionSkillConfig {
    try {
        const raw = readFileSync(configPath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        if (!Value.Check(MentionSkillConfigSchema, parsedJson)) return {};
        return Value.Parse(MentionSkillConfigSchema, parsedJson);
    } catch {
        return {};
    }
}

function applyMentionSkillSettings(
    settings: Record<string, unknown>,
    target: MentionSkillSettings,
): void {
    const trigger = parseOptionalString(MentionTriggerSchema, settings[TRIGGER_SETTINGS_KEY]);
    if (trigger !== undefined) {
        target.trigger = trigger;
    }

    const hideSlashSkills = parseOptionalBoolean(
        HideSlashSkillsSchema,
        settings[HIDE_SLASH_SKILLS_SETTINGS_KEY],
    );
    if (hideSlashSkills !== undefined) {
        target.hideSlashSkills = hideSlashSkills;
    }

    const completionSuffix = parseOptionalString(
        CompletionSuffixSchema,
        settings[COMPLETION_SUFFIX_SETTINGS_KEY],
    );
    if (completionSuffix !== undefined) {
        target.completionSuffix = completionSuffix;
    }
}

export function configuredMentionSkillSettings(
    ctx: MentionSkillSettingsContext,
): MentionSkillSettings {
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
        cachedMentionSkillSettings?.cwd === ctx.cwd &&
        cachedMentionSkillSettings.projectTrusted === projectTrusted &&
        cachedMentionSkillSettings.globalConfigSignature === globalConfigSignature &&
        cachedMentionSkillSettings.projectConfigSignature === projectConfigSignature
    ) {
        return cloneMentionSkillSettings(cachedMentionSkillSettings.settings);
    }

    const loaded: MentionSkillSettings = {
        trigger: DEFAULT_MENTION_TRIGGER,
        hideSlashSkills: true,
        completionSuffix: DEFAULT_COMPLETION_SUFFIX,
    };

    applyMentionSkillSettings(readConfigFile(globalConfigPath), loaded);
    if (projectConfigPath !== undefined) {
        applyMentionSkillSettings(readConfigFile(projectConfigPath), loaded);
    }

    cachedMentionSkillSettings = {
        cwd: ctx.cwd,
        projectTrusted,
        globalConfigSignature,
        projectConfigSignature,
        settings: cloneMentionSkillSettings(loaded),
    };
    return loaded;
}
