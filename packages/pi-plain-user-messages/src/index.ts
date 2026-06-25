import {
    Text,
    type Component,
    type DefaultTextStyle,
    type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USER_MESSAGE_PLAINTEXT_PATCH_KEY = Symbol.for(
    "zigai.pi-plain-user-messages.user-message-patched",
);

const plainTextUserMessages = new WeakSet<object>();

type PatchState = typeof globalThis & {
    [USER_MESSAGE_PLAINTEXT_PATCH_KEY]?: boolean;
};

type MarkdownInternals = {
    text?: unknown;
    paddingX?: unknown;
    paddingY?: unknown;
    defaultTextStyle?: DefaultTextStyle;
    theme?: MarkdownTheme;
};

type UserMessageComponentInstance = Component & {
    contentBox?: unknown;
};

type UserMessageComponentPrototype = {
    render(this: UserMessageComponentInstance, width: number): string[];
};

type BoxLike = {
    children: unknown[];
    invalidate(): void;
};

function readString(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    return "";
}

function readPadding(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return value;
    }
    return 0;
}

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function hasConstructorName(value: object, name: string): boolean {
    const constructorValue = Reflect.get(value, "constructor");
    if (!isObject(constructorValue)) {
        return false;
    }

    return Reflect.get(constructorValue, "name") === name;
}

function isBoxLike(value: unknown): value is BoxLike {
    if (!isObject(value)) {
        return false;
    }

    const children = Reflect.get(value, "children");
    const invalidate = Reflect.get(value, "invalidate");
    return Array.isArray(children) && typeof invalidate === "function";
}

function isMarkdownLike(value: unknown): value is MarkdownInternals {
    if (!isObject(value)) {
        return false;
    }

    if (typeof Reflect.get(value, "text") !== "string") {
        return false;
    }

    if (hasConstructorName(value, "Markdown")) {
        return true;
    }

    return typeof Reflect.get(value, "renderToken") === "function";
}

class PlainMarkdownText implements Component {
    private readonly text: string;
    private readonly paddingX: number;
    private readonly paddingY: number;
    private readonly defaultTextStyle: DefaultTextStyle | undefined;
    private readonly markdownTheme: MarkdownTheme | undefined;

    constructor(markdown: MarkdownInternals) {
        this.text = readString(markdown.text);
        this.paddingX = readPadding(markdown.paddingX);
        this.paddingY = readPadding(markdown.paddingY);
        this.defaultTextStyle = markdown.defaultTextStyle;
        this.markdownTheme = markdown.theme;
    }

    invalidate(): void {
        return;
    }

    render(width: number): string[] {
        if (this.text.trim().length === 0) {
            return [];
        }

        const text = new Text(
            this.applyDefaultStyle(this.text),
            this.paddingX,
            this.paddingY,
            this.defaultTextStyle?.bgColor,
        );
        return text.render(width);
    }

    private applyDefaultStyle(text: string): string {
        const defaultTextStyle = this.defaultTextStyle;
        if (defaultTextStyle === undefined) {
            return text;
        }

        let styled = text;
        if (defaultTextStyle.color !== undefined) {
            styled = defaultTextStyle.color(styled);
        }

        const markdownTheme = this.markdownTheme;
        if (markdownTheme === undefined) {
            return styled;
        }

        if (defaultTextStyle.bold === true) {
            styled = markdownTheme.bold(styled);
        }
        if (defaultTextStyle.italic === true) {
            styled = markdownTheme.italic(styled);
        }
        if (defaultTextStyle.strikethrough === true) {
            styled = markdownTheme.strikethrough(styled);
        }
        if (defaultTextStyle.underline === true) {
            styled = markdownTheme.underline(styled);
        }

        return styled;
    }
}

function getPatchState(): PatchState {
    return globalThis as PatchState;
}

async function resolvePiDistDir(): Promise<string> {
    const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    return dirname(codingAgentEntry);
}

function warnInternalPatchUnavailable(feature: string, error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(
        `[pi-plain-user-messages] ${feature} unavailable; Pi internals may have changed${suffix}`,
    );
}

function isUserMessagePrototype(value: unknown): value is UserMessageComponentPrototype {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return typeof Reflect.get(value, "render") === "function";
}

async function loadUserMessagePrototype(): Promise<UserMessageComponentPrototype | undefined> {
    try {
        const distDir = await resolvePiDistDir();
        const userMessagePath = pathToFileURL(
            join(distDir, "modes/interactive/components/user-message.js"),
        ).href;
        const userMessageModule = (await import(userMessagePath)) as {
            UserMessageComponent?: { prototype?: unknown };
        };
        const prototype = userMessageModule.UserMessageComponent?.prototype;
        if (isUserMessagePrototype(prototype)) {
            return prototype;
        }
        warnInternalPatchUnavailable("user message patch");
    } catch (error: unknown) {
        warnInternalPatchUnavailable("user message patch", error);
    }

    return undefined;
}

function replaceMarkdownChildrenWithPlainText(contentBox: BoxLike): boolean {
    let replaced = false;

    for (let index = 0; index < contentBox.children.length; index++) {
        const child = contentBox.children[index];
        if (isMarkdownLike(child)) {
            contentBox.children[index] = new PlainMarkdownText(child);
            replaced = true;
        }
    }

    if (replaced) {
        contentBox.invalidate();
    }

    return replaced;
}

function ensurePlainTextUserMessage(instance: UserMessageComponentInstance): void {
    if (plainTextUserMessages.has(instance)) {
        return;
    }

    const contentBox = instance.contentBox;
    if (isBoxLike(contentBox)) {
        replaceMarkdownChildrenWithPlainText(contentBox);
    }

    plainTextUserMessages.add(instance);
}

async function patchUserMessageRendering(): Promise<void> {
    const state = getPatchState();
    if (state[USER_MESSAGE_PLAINTEXT_PATCH_KEY] === true) {
        return;
    }

    const userMessagePrototype = await loadUserMessagePrototype();
    if (userMessagePrototype === undefined) {
        return;
    }

    const originalRender = Reflect.get(userMessagePrototype, "render") as
        | ((this: UserMessageComponentInstance, width: number) => string[])
        | undefined;
    if (typeof originalRender !== "function") {
        warnInternalPatchUnavailable("user message render patch");
        return;
    }

    userMessagePrototype.render = function patchedUserMessageRender(
        this: UserMessageComponentInstance,
        width: number,
    ): string[] {
        ensurePlainTextUserMessage(this);
        return originalRender.call(this, width);
    };

    state[USER_MESSAGE_PLAINTEXT_PATCH_KEY] = true;
}

export default async function plainUserMessagesExtension(): Promise<void> {
    await patchUserMessageRendering();
}
