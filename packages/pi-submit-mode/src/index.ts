import { AgentSession } from "@earendil-works/pi-coding-agent";

type PromptOptions = Parameters<AgentSession["prompt"]>[1];
type PromptResult = ReturnType<AgentSession["prompt"]>;

const SWAP_MARKER = Symbol.for("pi-ui-tweaks.swap-submit-and-follow-up");

type PatchableAgentSessionPrototype = AgentSession & {
    [SWAP_MARKER]?: true;
};

function swappedStreamingBehavior(options: PromptOptions): PromptOptions {
    if (options?.streamingBehavior === "steer") {
        return { ...options, streamingBehavior: "followUp" };
    }

    if (options?.streamingBehavior === "followUp") {
        return { ...options, streamingBehavior: "steer" };
    }

    return options;
}

export default function messageSubmitMode() {
    const prototype = AgentSession.prototype as PatchableAgentSessionPrototype;
    if (prototype[SWAP_MARKER] === true) return;

    const originalPrompt = Reflect.get(AgentSession.prototype, "prompt") as AgentSession["prompt"];
    AgentSession.prototype.prompt = function promptWithSwappedStreamingBehavior(
        this: AgentSession,
        text: string,
        options?: PromptOptions,
    ): PromptResult {
        return originalPrompt.call(this, text, swappedStreamingBehavior(options));
    };

    prototype[SWAP_MARKER] = true;
}
