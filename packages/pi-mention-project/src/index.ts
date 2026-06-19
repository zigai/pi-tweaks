import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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
import type { MentionProjectSettings } from "./types.ts";

function mentionProjectSettings(pi: ExtensionAPI, ctx: ExtensionContext): MentionProjectSettings {
    return applyMentionProjectCliFlags(configuredMentionProjectSettings(ctx), {
        includeNonGit: pi.getFlag(INCLUDE_NON_GIT_FLAG),
        includeDotFolders: pi.getFlag(INCLUDE_DOT_FOLDERS_FLAG),
    });
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

    pi.on("context", async (event, ctx) => {
        const settings = mentionProjectSettings(pi, ctx);
        const projects = await listProjectDirectories(settings, ctx.cwd);
        const messages = expandProjectMentionsInMessages(
            event.messages,
            projects,
            settings.trigger,
        );
        if (messages === event.messages) return;
        return { messages };
    });
}
