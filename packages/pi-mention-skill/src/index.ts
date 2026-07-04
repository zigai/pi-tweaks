import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createSkillMentionProvider } from "./autocomplete.ts";
import { applyMentionSkillEditor } from "./editor.ts";
import {
    contextContainsSkillMentionTrigger,
    createCachedSkillExpansionLoader,
    expandSkillMentionsInMessages,
} from "./expand-mentions.ts";
import { configuredMentionSkillSettings } from "./settings.ts";
import { createSkillCommandSource } from "./skill-commands.ts";

export default function (pi: ExtensionAPI): void {
    const loadSkillExpansion = createCachedSkillExpansionLoader();
    const skillSource = createSkillCommandSource(pi);

    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI) return;
        const settings = configuredMentionSkillSettings(ctx);
        skillSource.refresh();
        applyMentionSkillEditor(ctx, settings.trigger, () => skillSource.getCachedSkillNames());
        ctx.ui.addAutocompleteProvider((current) =>
            createSkillMentionProvider(current, settings, () => skillSource.getSkillCommands()),
        );
    });

    pi.on("context", async (event, ctx) => {
        const { trigger } = configuredMentionSkillSettings(ctx);
        if (!contextContainsSkillMentionTrigger(event.messages, trigger)) return;

        const messages = await expandSkillMentionsInMessages(
            event.messages,
            skillSource.getSkillCommands(),
            trigger,
            loadSkillExpansion,
        );
        if (messages === event.messages) return;
        return { messages };
    });
}
