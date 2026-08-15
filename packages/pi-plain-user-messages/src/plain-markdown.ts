import {
    Text,
    type Component,
    type DefaultTextStyle,
    type MarkdownTheme,
} from "@earendil-works/pi-tui";

const plainTextUserMessageBoxes = new WeakMap<object, BoxLike>();

type MarkdownInternals = {
    text?: unknown;
    paddingX?: unknown;
    paddingY?: unknown;
    defaultTextStyle?: DefaultTextStyle;
    theme?: MarkdownTheme;
};
export type UserMessageComponentInstance = Component & {
    contentBox?: unknown;
    children?: unknown[];
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

function getUnknownProperty(value: unknown, key: PropertyKey): unknown {
    if (!isObject(value)) {
        return undefined;
    }
    return Reflect.get(value, key) as unknown;
}

function hasConstructorName(value: object, name: string): boolean {
    const constructorValue = getUnknownProperty(value, "constructor");
    if (!isObject(constructorValue)) {
        return false;
    }

    return getUnknownProperty(constructorValue, "name") === name;
}

function isBoxLike(value: unknown): value is BoxLike {
    if (!isObject(value)) {
        return false;
    }

    const children = getUnknownProperty(value, "children");
    const invalidate = getUnknownProperty(value, "invalidate");
    return Array.isArray(children) && typeof invalidate === "function";
}

function isMarkdownLike(value: unknown): value is MarkdownInternals {
    if (!isObject(value)) {
        return false;
    }

    if (typeof getUnknownProperty(value, "text") !== "string") {
        return false;
    }

    if (hasConstructorName(value, "Markdown")) {
        return true;
    }

    return typeof getUnknownProperty(value, "renderToken") === "function";
}

export class PlainMarkdownText implements Component {
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

function findUserMessageContentBox(instance: UserMessageComponentInstance): BoxLike | undefined {
    const candidates: unknown[] = [getUnknownProperty(instance, "contentBox"), instance];
    const visited = new Set<object>();

    while (candidates.length > 0) {
        const candidate = candidates.pop();
        if (!isObject(candidate) || visited.has(candidate)) {
            continue;
        }
        visited.add(candidate);

        if (!isBoxLike(candidate)) {
            continue;
        }

        if (candidate.children.some((child) => isMarkdownLike(child))) {
            return candidate;
        }

        for (const child of candidate.children) {
            candidates.push(child);
        }
    }

    return undefined;
}

export function ensurePlainTextUserMessage(instance: UserMessageComponentInstance): void {
    const contentBox = findUserMessageContentBox(instance);
    if (contentBox === undefined) {
        return;
    }

    if (plainTextUserMessageBoxes.get(instance) === contentBox) {
        return;
    }

    replaceMarkdownChildrenWithPlainText(contentBox);
    plainTextUserMessageBoxes.set(instance, contentBox);
}
