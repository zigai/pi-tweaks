import { AgentSession } from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

type PromptOptions = Parameters<AgentSession["prompt"]>[1];
type PromptResult = ReturnType<AgentSession["prompt"]>;

const SWAP_MARKER = Symbol.for("pi-ui-tweaks.swap-submit-and-follow-up");
const TERMINAL_ENTER_MARKER = Symbol.for("pi-ui-tweaks.terminal-lf-enter-submit");

type PatchableAgentSessionPrototype = AgentSession & {
    [SWAP_MARKER]?: true;
};

type PatchableEditorPrototype = Editor & {
    [TERMINAL_ENTER_MARKER]?: true;
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

function isNonEmpty(value: string | undefined): boolean {
    return value !== undefined && value.length > 0;
}

function shouldNormalizeLfEnter(): boolean {
    return (
        isNonEmpty(process.env.SSH_CONNECTION) ||
        isNonEmpty(process.env.SSH_CLIENT) ||
        isNonEmpty(process.env.SSH_TTY) ||
        isNonEmpty(process.env.TMUX)
    );
}

function patchStreamingBehaviorSwap() {
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

function patchTerminalLfEnterSubmit() {
    if (!shouldNormalizeLfEnter()) return;

    const prototype = Editor.prototype as PatchableEditorPrototype;
    if (prototype[TERMINAL_ENTER_MARKER] === true) return;

    const originalHandleInput = Reflect.get(
        Editor.prototype,
        "handleInput",
    ) as Editor["handleInput"];
    Editor.prototype.handleInput = function handleSshLfEnterAsSubmit(
        this: Editor,
        data: string,
    ): void {
        let normalizedData = data;
        if (data === "\n") {
            normalizedData = "\r";
        }
        originalHandleInput.call(this, normalizedData);
    };

    prototype[TERMINAL_ENTER_MARKER] = true;
}

export default function messageSubmitMode() {
    patchStreamingBehaviorSwap();
    patchTerminalLfEnterSubmit();
}
