import { CURSOR_MARKER, Input, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import {
    installLinkedRenderPatch,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

export const DEFAULT_INPUT_PROMPT_PREFIX = "> ";
const INPUT_PROMPT_PATCH_KEY = Symbol.for("zigai.pi-ui-tweaks.input-prompt-prefix-patch");
const graphemeSegmenter = new Intl.Segmenter();

type InputRenderTarget = {
    [INPUT_PROMPT_PATCH_KEY]?: InputPromptPrefixPatchRecord;
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
    const value: unknown = Reflect.get(target, key) as unknown;
    if (typeof value === "string") {
        return value;
    }
    return undefined;
}

function readInputNumber(target: InputRenderTarget, key: string): number | undefined {
    const value: unknown = Reflect.get(target, key) as unknown;
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    return undefined;
}

function readInputBoolean(target: InputRenderTarget, key: string): boolean | undefined {
    const value: unknown = Reflect.get(target, key) as unknown;
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

export type InputPromptPrefixConfig = { readonly inputPromptPrefix: string };
export type InputPromptPrefixHandle = {
    update(config: InputPromptPrefixConfig): void;
    dispose(): void;
};
type InputPromptPrefixPatchRecord = {
    readonly original: InputRenderTarget["render"];
    readonly patch: LinkedMethodPatchHandle<InputRenderTarget, [number], string[]>;
    readonly handle: InputPromptPrefixHandle;
};

/** Installs or updates the single-line input prompt patch. */
export function installInputPromptPrefixPatch(
    config: InputPromptPrefixConfig,
    target: unknown = Input.prototype,
): InputPromptPrefixHandle {
    if (!isInputRenderTarget(target)) {
        warnInputPromptPrefixPatchUnavailable();
        return { update(): void {}, dispose(): void {} };
    }
    const installed = target[INPUT_PROMPT_PATCH_KEY];
    if (installed !== undefined) {
        installed.handle.update(config);
        return installed.handle;
    }
    let current = { inputPromptPrefix: normalizeInputPromptPrefix(config.inputPromptPrefix) };
    const patch = installLinkedRenderPatch(
        target,
        (predecessor) =>
            function inputPromptPrefixRender(this: InputRenderTarget, width: number): string[] {
                const value = readInputString(this, "value");
                const cursor = readInputNumber(this, "cursor");
                const focused = readInputBoolean(this, "focused");
                if (value === undefined || cursor === undefined || focused === undefined) {
                    return predecessor.call(this, width);
                }

                const prompt = current.inputPromptPrefix;
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
            },
    );
    let disposed = false;
    const handle: InputPromptPrefixHandle = {
        update(next): void {
            if (!disposed)
                current = { inputPromptPrefix: normalizeInputPromptPrefix(next.inputPromptPrefix) };
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            patch.dispose();
            if (target[INPUT_PROMPT_PATCH_KEY]?.handle === handle)
                delete target[INPUT_PROMPT_PATCH_KEY];
        },
    };
    target[INPUT_PROMPT_PATCH_KEY] = { original: patch.predecessor, patch, handle };
    return handle;
}
