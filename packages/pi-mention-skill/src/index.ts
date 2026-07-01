import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createSkillMentionProvider } from "./autocomplete.ts";
import { applyMentionSkillEditor } from "./editor.ts";
import { expandSkillMentionsInMessages } from "./expand-mentions.ts";
import { configuredMentionSkillSettings } from "./settings.ts";
import { getSkillCommands } from "./skill-commands.ts";

export default function (pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI) return;
        const settings = configuredMentionSkillSettings(ctx);
        applyMentionSkillEditor(pi, ctx, settings.trigger);
        ctx.ui.addAutocompleteProvider((current) =>
            createSkillMentionProvider(pi, current, settings),
        );
    });

    pi.on("context", async (event, ctx) => {
        const { trigger } = configuredMentionSkillSettings(ctx);
        const messages = await expandSkillMentionsInMessages(
            event.messages,
            getSkillCommands(pi),
            trigger,
        );
        if (messages === event.messages) return;
        return { messages };
    });
}
