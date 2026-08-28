import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    installLinkedRenderPatch,
    loadPiInternalModule,
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

function isObjectIdentity(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

const userMessagePrototypeParser = {
    parse: (module: unknown): UserMessageComponentPrototype | undefined => {
        if (!isObjectIdentity(module) || !("UserMessageComponent" in module)) {
            return undefined;
        }
        const component = module.UserMessageComponent;
        if (!isObjectIdentity(component) || !("prototype" in component)) return undefined;
        const prototype = component.prototype;
        if (
            !isObjectIdentity(prototype) ||
            !("render" in prototype) ||
            typeof prototype.render !== "function"
        ) {
            return undefined;
        }
        // SAFETY: The consumed render method is callable; its private receiver signature
        // is fixed by the pinned Pi package and exercised by package integration tests.
        return prototype as UserMessageComponentPrototype;
    },
};
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
        parse: userMessagePrototypeParser.parse,
    });
    if (prototype === undefined) return;

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
