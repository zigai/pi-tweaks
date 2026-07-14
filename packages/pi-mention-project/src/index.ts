import type {
    ContextEvent,
    ExtensionAPI,
    ExtensionHandler,
    InputEvent,
    InputEventResult,
    SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { createProjectMentionProvider } from "./autocomplete.ts";
import { applyMentionProjectEditor } from "./editor.ts";
import {
    contextContainsProjectMentionTrigger,
    expandProjectMentions,
    expandProjectMentionsInMessages,
} from "./expand-mentions.ts";
import { createProjectDirectorySource, listProjectDirectories } from "./projects.ts";
import {
    applyMentionProjectCliFlags,
    loadMentionProjectSettings,
    INCLUDE_DOT_FOLDERS_FLAG,
    INCLUDE_NON_GIT_FLAG,
    type MentionProjectSettingsContext,
} from "./settings.ts";
import type { MentionProjectSettings, ProjectDirectory } from "./types.ts";

function mentionProjectSettings(
    pi: Pick<ExtensionAPI, "getFlag">,
    ctx: MentionProjectSettingsContext,
): MentionProjectSettings {
    return applyMentionProjectCliFlags(loadMentionProjectSettings(ctx), {
        includeNonGit: pi.getFlag(INCLUDE_NON_GIT_FLAG),
        includeDotFolders: pi.getFlag(INCLUDE_DOT_FOLDERS_FLAG),
    });
}

type ProjectDirectoryLoader = (
    settings: MentionProjectSettings,
    cwd: string,
) => Promise<ProjectDirectory[]>;

type ProjectMentionContextResult = {
    messages: ContextEvent["messages"];
};

type ProjectMentionContextHandler = (
    event: ContextEvent,
    ctx: MentionProjectSettingsContext,
) => Promise<ProjectMentionContextResult | undefined>;

type ProjectMentionInputHandler = (
    event: InputEvent,
    ctx: MentionProjectSettingsContext,
) => Promise<InputEventResult>;

export type ProjectMentionHandlerMap = {
    session_start: ExtensionHandler<SessionStartEvent>;
    input: ProjectMentionInputHandler;
    context: ProjectMentionContextHandler;
};

export type ProjectMentionExtensionApi = Pick<ExtensionAPI, "registerFlag" | "getFlag"> & {
    on<TKey extends keyof ProjectMentionHandlerMap>(
        event: TKey,
        handler: ProjectMentionHandlerMap[TKey],
    ): void;
};

export function createProjectMentionInputHandler(
    pi: Pick<ExtensionAPI, "getFlag">,
    loadProjects: ProjectDirectoryLoader = listProjectDirectories,
): ProjectMentionInputHandler {
    return async (event, ctx) => {
        const settings = mentionProjectSettings(pi, ctx);
        if (event.streamingBehavior !== undefined || !event.text.includes(settings.trigger)) {
            return { action: "continue" };
        }

        const projects = await loadProjects(settings, ctx.cwd);
        const expanded = expandProjectMentions(event.text, projects, settings.trigger);
        if (expanded === event.text) return { action: "continue" };
        return { action: "transform", text: expanded, images: event.images };
    };
}

export function createProjectMentionContextHandler(
    pi: Pick<ExtensionAPI, "getFlag">,
    loadProjects: ProjectDirectoryLoader = listProjectDirectories,
): ProjectMentionContextHandler {
    return async (event, ctx) => {
        const settings = mentionProjectSettings(pi, ctx);
        if (!contextContainsProjectMentionTrigger(event.messages, settings.trigger))
            return undefined;

        const projects = await loadProjects(settings, ctx.cwd);
        const messages = expandProjectMentionsInMessages(
            event.messages,
            projects,
            settings.trigger,
        );
        if (messages === event.messages) return undefined;
        return { messages };
    };
}

export function registerProjectMentionExtension(pi: ProjectMentionExtensionApi): void {
    pi.registerFlag(INCLUDE_NON_GIT_FLAG, {
        description: "Include non-Git child folders in pi-mention-project suggestions.",
        type: "boolean",
        default: false,
    });
    pi.registerFlag(INCLUDE_DOT_FOLDERS_FLAG, {
        description: "Include dot-prefixed child folders in pi-mention-project suggestions.",
        type: "boolean",
        default: false,
    });

    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI) return;
        const settings = mentionProjectSettings(pi, ctx);
        const projectSource = createProjectDirectorySource(settings, ctx.cwd);
        void projectSource.refresh();

        applyMentionProjectEditor(ctx, settings.trigger, () =>
            projectSource.getCachedProjectNames(),
        );
        ctx.ui.addAutocompleteProvider((current) =>
            createProjectMentionProvider(current, settings, (options) =>
                projectSource.getProjects(options),
            ),
        );
    });

    pi.on("input", createProjectMentionInputHandler(pi));
    pi.on("context", createProjectMentionContextHandler(pi));
}

export default function (pi: ExtensionAPI): void {
    registerProjectMentionExtension(pi);
}
