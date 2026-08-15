import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    installLinkedRenderPatch,
    loadPiInternalModule,
    warnPiInternalPatchUnavailable,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

import { ensurePlainTextUserMessage, type UserMessageComponentInstance } from "./plain-markdown.ts";

const USER_MESSAGE_PLAINTEXT_PATCH_KEY = Symbol.for(
    "zigai.pi-plain-user-messages.user-message-patched",
);
const SCOPE = "pi-plain-user-messages";

type UserMessageComponentPrototype = {
    render(this: UserMessageComponentInstance, width: number): string[];
};

type UserMessagePatchHandle = LinkedMethodPatchHandle<
    UserMessageComponentInstance,
    [width: number],
    string[]
>;

type PatchState = typeof globalThis & {
    [USER_MESSAGE_PLAINTEXT_PATCH_KEY]?: UserMessagePatchHandle | true;
};

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function parseUserMessagePrototype(module: unknown): UserMessageComponentPrototype | undefined {
    const component = getUnknownProperty(module, "UserMessageComponent");
    const prototype = getUnknownProperty(component, "prototype");
    if (
        (typeof prototype === "object" || typeof prototype === "function") &&
        prototype !== null &&
        typeof getUnknownProperty(prototype, "render") === "function"
    ) {
        return prototype as UserMessageComponentPrototype;
    }
    return undefined;
}

function restoreUserMessageRenderingPatch(): void {
    const state: PatchState = globalThis;
    const patch = state[USER_MESSAGE_PLAINTEXT_PATCH_KEY];
    if (patch === undefined || patch === true) return;
    patch.dispose();
    delete state[USER_MESSAGE_PLAINTEXT_PATCH_KEY];
}

async function patchUserMessageRendering(): Promise<void> {
    const state: PatchState = globalThis;
    if (state[USER_MESSAGE_PLAINTEXT_PATCH_KEY] !== undefined) return;

    const prototype = await loadPiInternalModule("modes/interactive/components/user-message.js", {
        scope: SCOPE,
        feature: "user message patch",
        parse: parseUserMessagePrototype,
    });
    if (prototype === undefined) return;
    if (typeof prototype.render !== "function") {
        warnPiInternalPatchUnavailable(SCOPE, "user message render patch");
        return;
    }

    state[USER_MESSAGE_PLAINTEXT_PATCH_KEY] = installLinkedRenderPatch(
        prototype,
        (predecessor) =>
            function plainUserMessageRender(
                this: UserMessageComponentInstance,
                width: number,
            ): string[] {
                ensurePlainTextUserMessage(this);
                return predecessor.call(this, width);
            },
    );
}

export default async function plainUserMessagesExtension(pi?: ExtensionAPI): Promise<void> {
    await patchUserMessageRendering();
    pi?.on("session_shutdown", restoreUserMessageRenderingPatch);
}
