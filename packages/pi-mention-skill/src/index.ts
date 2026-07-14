import type {
    ContextEvent,
    ExtensionAPI,
    ExtensionHandler,
    SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { createSkillMentionProvider } from "./autocomplete.ts";
import { applyMentionSkillEditor } from "./editor.ts";
import {
    contextContainsSkillMentionTrigger,
    createCachedSkillExpansionLoader,
    expandSkillMentionsInMessages,
    type SkillExpansionLoader,
} from "./expand-mentions.ts";
import { loadMentionSkillSettings } from "./settings.ts";
import { createSkillCommandSource, type SkillCommandSource } from "./skill-commands.ts";

type SkillMentionContextResult = {
    messages: ContextEvent["messages"];
};

type SkillMentionContextHandler = (
    event: ContextEvent,
    ctx: import("./settings.ts").MentionSkillSettingsContext,
) => Promise<SkillMentionContextResult | undefined>;

export type MentionSkillHandlerMap = {
    session_start: ExtensionHandler<SessionStartEvent>;
    context: SkillMentionContextHandler;
};

export type MentionSkillExtensionApi = Pick<ExtensionAPI, "getCommands"> & {
    on<TKey extends keyof MentionSkillHandlerMap>(
        event: TKey,
        handler: MentionSkillHandlerMap[TKey],
    ): void;
};

export function createSkillMentionContextHandler(
    skillSource: Pick<SkillCommandSource, "getSkillCommands">,
    loadSkillExpansion: SkillExpansionLoader,
): SkillMentionContextHandler {
    return async (event, ctx) => {
        const { trigger } = loadMentionSkillSettings(ctx);
        if (!contextContainsSkillMentionTrigger(event.messages, trigger)) return;

        const messages = await expandSkillMentionsInMessages(
            event.messages,
            skillSource.getSkillCommands(),
            trigger,
            loadSkillExpansion,
        );
        if (messages === event.messages) return;
        return { messages };
    };
}

export default function (pi: MentionSkillExtensionApi): void {
    const loadSkillExpansion = createCachedSkillExpansionLoader();
    const skillSource = createSkillCommandSource(pi);

    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI) return;
        const settings = loadMentionSkillSettings(ctx);
        skillSource.refresh();
        applyMentionSkillEditor(ctx, settings.trigger, () => skillSource.getCachedSkillNames());
        ctx.ui.addAutocompleteProvider((current) =>
            createSkillMentionProvider(current, settings, () => skillSource.getSkillCommands()),
        );
    });

    pi.on("context", createSkillMentionContextHandler(skillSource, loadSkillExpansion));
}
