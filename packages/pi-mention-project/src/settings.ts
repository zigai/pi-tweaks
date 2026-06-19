import {
    getAgentDir,
    SettingsManager,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

import type { MentionProjectSettings } from "./types.ts";

export const DEFAULT_MENTION_TRIGGER = "#";
export const INCLUDE_NON_GIT_FLAG = "mention-project-include-non-git";
export const INCLUDE_DOT_FOLDERS_FLAG = "mention-project-include-dot-folders";

const TRIGGER_SETTINGS_KEY = "mentionProjectTrigger";
const ROOTS_SETTINGS_KEY = "mentionProjectRoots";
const GIT_REPOS_ONLY_SETTINGS_KEY = "mentionProjectGitReposOnly";
const INCLUDE_DOT_FOLDERS_SETTINGS_KEY = "mentionProjectIncludeDotFolders";

const MentionTriggerSchema = Type.String({ minLength: 1, maxLength: 1, pattern: "^[^/\\s]$" });
const ProjectRootsSchema = Type.Array(Type.String({ minLength: 1 }));
const BooleanSchema = Type.Boolean();

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

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) return undefined;
        return [trimmed];
    }

    if (!Value.Check(ProjectRootsSchema, value)) return undefined;
    const parsed: unknown = Value.Parse(ProjectRootsSchema, value);
    if (!Array.isArray(parsed)) return undefined;

    const roots = parsed.filter((entry): entry is string => {
        return typeof entry === "string" && entry.trim().length > 0;
    });
    if (roots.length === 0 && parsed.length > 0) return undefined;
    return roots;
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
}

export function configuredMentionProjectSettings(ctx: ExtensionContext): MentionProjectSettings {
    const loaded: MentionProjectSettings = {
        trigger: DEFAULT_MENTION_TRIGGER,
        roots: [],
        gitReposOnly: true,
        includeDotFolders: false,
    };

    const manager = SettingsManager.create(ctx.cwd, getAgentDir(), {
        projectTrusted: isProjectTrusted(ctx),
    });
    applyMentionProjectSettings(manager.getGlobalSettings() as Record<string, unknown>, loaded);
    applyMentionProjectSettings(manager.getProjectSettings() as Record<string, unknown>, loaded);
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
