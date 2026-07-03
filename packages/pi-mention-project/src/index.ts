import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createProjectMentionProvider } from "./autocomplete.ts";
import { applyMentionProjectEditor } from "./editor.ts";
import { expandProjectMentions, expandProjectMentionsInMessages } from "./expand-mentions.ts";
import { createProjectDirectorySource, listProjectDirectories } from "./projects.ts";
import {
    applyMentionProjectCliFlags,
    configuredMentionProjectSettings,
    INCLUDE_DOT_FOLDERS_FLAG,
    INCLUDE_NON_GIT_FLAG,
} from "./settings.ts";
import type { MentionProjectSettings, ProjectDirectory } from "./types.ts";

function mentionProjectSettings(pi: ExtensionAPI, ctx: ExtensionContext): MentionProjectSettings {
    return applyMentionProjectCliFlags(configuredMentionProjectSettings(ctx), {
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
    ctx: ExtensionContext,
) => Promise<ProjectMentionContextResult | undefined>;

type ContextMessage = ContextEvent["messages"][number];
type UserContextMessage = Extract<ContextMessage, { role: "user" }>;
type UserContentBlock = Exclude<UserContextMessage["content"], string>[number];

function contentBlockContainsTrigger(block: UserContentBlock, trigger: string): boolean {
    return block.type === "text" && block.text.includes(trigger);
}

function contextContainsTrigger(messages: ContextEvent["messages"], trigger: string): boolean {
    return messages.some((message) => {
        if (message.role !== "user") return false;
        if (typeof message.content === "string") return message.content.includes(trigger);
        return message.content.some((block) => contentBlockContainsTrigger(block, trigger));
    });
}

export function createProjectMentionContextHandler(
    pi: ExtensionAPI,
    loadProjects: ProjectDirectoryLoader = listProjectDirectories,
): ProjectMentionContextHandler {
    return async (event, ctx) => {
        const settings = mentionProjectSettings(pi, ctx);
        if (!contextContainsTrigger(event.messages, settings.trigger)) return undefined;

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

export default function (pi: ExtensionAPI): void {
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

        applyMentionProjectEditor(ctx, settings.trigger, () => projectSource.getCachedProjects());
        ctx.ui.addAutocompleteProvider((current) =>
            createProjectMentionProvider(current, settings, () => projectSource.getProjects()),
        );
    });

    pi.on("input", async (event, ctx) => {
        const settings = mentionProjectSettings(pi, ctx);
        if (!event.text.includes(settings.trigger)) return { action: "continue" };

        if (event.streamingBehavior !== undefined) {
            return { action: "continue" };
        }

        const projects = await listProjectDirectories(settings, ctx.cwd);
        const expanded = expandProjectMentions(event.text, projects, settings.trigger);
        if (expanded === event.text) return { action: "continue" };
        return { action: "transform", text: expanded, images: event.images };
    });

    pi.on("context", createProjectMentionContextHandler(pi));
}
