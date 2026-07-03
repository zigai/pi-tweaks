import { CURSOR_MARKER, Input, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

const DEFAULT_INPUT_PROMPT_PREFIX = "> ";
const INPUT_PROMPT_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.input-prompt-prefix-patched");
const graphemeSegmenter = new Intl.Segmenter();

let inputPromptPrefix = DEFAULT_INPUT_PROMPT_PREFIX;

type InputRenderTarget = {
    [INPUT_PROMPT_PATCH_KEY]?: true;
    render(width: number): string[];
};

function normalizeInputPromptPrefix(prefix: string): string {
    if (prefix.length === 0) {
        return DEFAULT_INPUT_PROMPT_PREFIX;
    }
    if (/\s$/u.test(prefix)) {
        return prefix;
    }
    return `${prefix} `;
}

function readInputString(target: InputRenderTarget, key: string): string | undefined {
    const value = Reflect.get(target, key);
    if (typeof value === "string") {
        return value;
    }
    return undefined;
}

function readInputNumber(target: InputRenderTarget, key: string): number | undefined {
    const value = Reflect.get(target, key);
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    return undefined;
}

function readInputBoolean(target: InputRenderTarget, key: string): boolean | undefined {
    const value = Reflect.get(target, key);
    if (typeof value === "boolean") {
        return value;
    }
    return undefined;
}

function warnInputPromptPrefixPatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined && reason.length > 0) {
        suffix = `: ${reason}`;
    }
    console.warn(
        `[pi-ui-tweaks] input prompt prefix patch unavailable; Pi internals may have changed${suffix}`,
    );
}

function isInputRenderTarget(value: unknown): value is InputRenderTarget {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return typeof Reflect.get(value, "render") === "function";
}

/**
 * Sets the prefix used by Pi single-line input boxes.
 */
export function setInputPromptPrefix(prefix: string): void {
    inputPromptPrefix = normalizeInputPromptPrefix(prefix);
}

export function getInputPromptPrefix(): string {
    return inputPromptPrefix;
}

/**
 * Installs an idempotent patch for Pi TUI's single-line input prompt marker.
 */
export function installInputPromptPrefixPatch(prototype: unknown = Input.prototype): void {
    if (!isInputRenderTarget(prototype)) {
        warnInputPromptPrefixPatchUnavailable();
        return;
    }
    if (prototype[INPUT_PROMPT_PATCH_KEY] === true) {
        return;
    }

    const originalRenderValue: unknown = Reflect.get(prototype, "render");
    if (typeof originalRenderValue !== "function") {
        warnInputPromptPrefixPatchUnavailable("missing render");
        return;
    }
    const originalRender = originalRenderValue as InputRenderTarget["render"];
    prototype.render = function inputPromptPrefixRender(
        this: InputRenderTarget,
        width: number,
    ): string[] {
        const value = readInputString(this, "value");
        const cursor = readInputNumber(this, "cursor");
        const focused = readInputBoolean(this, "focused");
        if (value === undefined || cursor === undefined || focused === undefined) {
            return originalRender.call(this, width);
        }

        const prompt = inputPromptPrefix;
        const promptWidth = visibleWidth(prompt);
        const availableWidth = width - promptWidth;
        if (availableWidth <= 0) {
            return [prompt];
        }

        let visibleText = "";
        let cursorDisplay = cursor;
        const totalWidth = visibleWidth(value);
        if (totalWidth < availableWidth) {
            visibleText = value;
        } else {
            let scrollWidth: number;
            if (cursor === value.length) {
                scrollWidth = availableWidth - 1;
            } else {
                scrollWidth = availableWidth;
            }
            const cursorCol = visibleWidth(value.slice(0, cursor));
            if (scrollWidth > 0) {
                const halfWidth = Math.floor(scrollWidth / 2);
                let startCol = 0;
                if (cursorCol < halfWidth) {
                    startCol = 0;
                } else if (cursorCol > totalWidth - halfWidth) {
                    startCol = Math.max(0, totalWidth - scrollWidth);
                } else {
                    startCol = Math.max(0, cursorCol - halfWidth);
                }
                visibleText = sliceByColumn(value, startCol, scrollWidth, true);
                const beforeCursor = sliceByColumn(
                    value,
                    startCol,
                    Math.max(0, cursorCol - startCol),
                    true,
                );
                cursorDisplay = beforeCursor.length;
            } else {
                visibleText = "";
                cursorDisplay = 0;
            }
        }

        const graphemes = [...graphemeSegmenter.segment(visibleText.slice(cursorDisplay))];
        const cursorGrapheme = graphemes[0];
        const beforeCursor = visibleText.slice(0, cursorDisplay);
        const atCursor = cursorGrapheme?.segment ?? " ";
        const afterCursor = visibleText.slice(cursorDisplay + atCursor.length);
        let marker = "";
        if (focused) {
            marker = CURSOR_MARKER;
        }
        const cursorChar = `\x1b[7m${atCursor}\x1b[27m`;
        const textWithCursor = beforeCursor + marker + cursorChar + afterCursor;
        const visualLength = visibleWidth(textWithCursor);
        const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
        return [prompt + textWithCursor + padding];
    };

    prototype[INPUT_PROMPT_PATCH_KEY] = true;
}
