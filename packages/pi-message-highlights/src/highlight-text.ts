const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ST = `${ESC}\\`;
const DEFAULT_FOREGROUND = `${ESC}[39m`;

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/g;
const FILE_EXTENSION_PATTERN = [
    "astro",
    "bash",
    "c",
    "cjs",
    "css",
    "gif",
    "go",
    "gql",
    "graphql",
    "h",
    "html?",
    "ico",
    "java",
    "jpeg",
    "jpg",
    "js",
    "jsonc?",
    "jsx",
    "kt",
    "kts",
    "less",
    "lock",
    "log",
    "mdx?",
    "mjs",
    "php",
    "png",
    "proto",
    "py",
    "rb",
    "rs",
    "sass",
    "scss",
    "sh",
    "sql",
    "sqlite",
    "svg",
    "svelte",
    "swift",
    "toml",
    "tsx?",
    "txt",
    "vue",
    "wasm",
    "webp",
    "ya?ml",
    "zsh",
].join("|");
const EXPLICIT_PATH_PREFIX_PATTERN = String.raw`(?:~/|\.{1,2}/|/)`;
const PATH_SEGMENT_PATTERN = String.raw`[A-Za-z0-9._~+@%-]+`;
const PATH_FILENAME_PATTERN = String.raw`${PATH_SEGMENT_PATTERN}\.(?:${FILE_EXTENSION_PATTERN})`;
const PREFIXED_PATH_PATTERN = String.raw`${EXPLICIT_PATH_PREFIX_PATTERN}${PATH_SEGMENT_PATTERN}(?:/${PATH_SEGMENT_PATTERN})*`;
const RELATIVE_FILE_PATH_PATTERN = String.raw`${PATH_SEGMENT_PATTERN}(?:/${PATH_SEGMENT_PATTERN})*/${PATH_FILENAME_PATTERN}`;
const BARE_FILENAME_PATTERN = String.raw`(?:${PATH_FILENAME_PATTERN}|Dockerfile|Justfile|Makefile|\.(?:env|gitignore|npmrc|prettierignore)(?:\.[A-Za-z0-9_-]+)?)`;
const LINE_SUFFIX_PATTERN = String.raw`(?::\d+(?:-\d+)?(?::\d+)?)?`;
const FILEPATH_REGEX = new RegExp(
    String.raw`(^|[\s([{<"'\x60])((?:${PREFIXED_PATH_PATTERN}|${RELATIVE_FILE_PATH_PATTERN}|${BARE_FILENAME_PATTERN})${LINE_SUFFIX_PATTERN})(?=$|[\s)\]}>"'\x60,.;:!?])`,
    "g",
);
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/;
const TRAILING_PATH_PUNCTUATION = /[.,;!?]+$/;

export const URL_BLUE_STYLE = `${ESC}[38;5;117m`;

export type HighlightStyles = {
    readonly url: string;
    readonly filepath: string;
};

type TextToken = {
    readonly kind: "text";
    readonly text: string;
    readonly plainStart: number;
    readonly plainEnd: number;
    readonly foreground: string | undefined;
};

type ControlToken = {
    readonly kind: "control";
    readonly text: string;
};

type Token = TextToken | ControlToken;

type HighlightRange = {
    readonly start: number;
    readonly end: number;
    readonly style: string;
};

function readEscapeSequence(text: string, start: number): string {
    const introducer = text[start + 1];
    if (introducer === undefined) return text.slice(start, start + 1);

    if (introducer === "[") {
        for (let index = start + 2; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            if (code >= 0x40 && code <= 0x7e) return text.slice(start, index + 1);
        }
        return text.slice(start);
    }

    if (introducer === "]" || introducer === "_" || introducer === "P" || introducer === "^") {
        const belIndex = text.indexOf(BEL, start + 2);
        const stIndex = text.indexOf(ST, start + 2);
        if (belIndex === -1 && stIndex === -1) return text.slice(start);
        if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
            return text.slice(start, belIndex + BEL.length);
        }
        return text.slice(start, stIndex + ST.length);
    }

    return text.slice(start, start + 2);
}

function parseSgrNumbers(sequence: string): number[] | undefined {
    if (!sequence.startsWith(`${ESC}[`) || !sequence.endsWith("m")) return undefined;

    const params = sequence.slice(2, -1);
    if (params.length === 0) return [0];

    const numbers: number[] = [];
    for (const param of params.split(";")) {
        if (param.length === 0) {
            numbers.push(0);
            continue;
        }
        const value = Number(param);
        if (!Number.isInteger(value)) return undefined;
        numbers.push(value);
    }
    return numbers;
}

function resolveForegroundAfterSgr(
    sequence: string,
    currentForeground: string | undefined,
): string | undefined {
    const numbers = parseSgrNumbers(sequence);
    if (numbers === undefined) return currentForeground;

    let foreground = currentForeground;
    for (let index = 0; index < numbers.length; index += 1) {
        const code = numbers[index] ?? 0;
        if (code === 0) {
            foreground = undefined;
        } else if (code === 39) {
            foreground = undefined;
        } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
            foreground = `${ESC}[${code}m`;
        } else if (code === 38) {
            const mode = numbers[index + 1];
            if (mode === 5) {
                const color = numbers[index + 2];
                if (color !== undefined) {
                    foreground = `${ESC}[38;5;${color}m`;
                    index += 2;
                }
            } else if (mode === 2) {
                const red = numbers[index + 2];
                const green = numbers[index + 3];
                const blue = numbers[index + 4];
                if (red !== undefined && green !== undefined && blue !== undefined) {
                    foreground = `${ESC}[38;2;${red};${green};${blue}m`;
                    index += 4;
                }
            }
        }
    }

    return foreground;
}

function tokenizeAnsi(text: string): { readonly tokens: Token[]; readonly plainText: string } {
    const tokens: Token[] = [];
    let plainText = "";
    let foreground: string | undefined;
    let index = 0;

    while (index < text.length) {
        if (text[index] === ESC) {
            const sequence = readEscapeSequence(text, index);
            foreground = resolveForegroundAfterSgr(sequence, foreground);
            tokens.push({ kind: "control", text: sequence });
            index += sequence.length;
            continue;
        }

        const start = index;
        while (index < text.length && text[index] !== ESC) {
            index += 1;
        }

        const tokenText = text.slice(start, index);
        tokens.push({
            kind: "text",
            text: tokenText,
            plainStart: plainText.length,
            plainEnd: plainText.length + tokenText.length,
            foreground,
        });
        plainText += tokenText;
    }

    return { tokens, plainText };
}

function getTrailingPunctuationPattern(kind: "url" | "filepath"): RegExp {
    if (kind === "url") return TRAILING_URL_PUNCTUATION;
    return TRAILING_PATH_PUNCTUATION;
}

function getBracketOpener(closingBracket: string): string {
    if (closingBracket === ")") return "(";
    if (closingBracket === "]") return "[";
    return "{";
}

function trimMatchEnd(text: string, kind: "url" | "filepath"): string {
    const trimmed = text.replace(getTrailingPunctuationPattern(kind), "");

    let result = trimmed;
    while (result.length > 0) {
        const last = result.at(-1);
        if (last !== ")" && last !== "]" && last !== "}") break;

        const opener = getBracketOpener(last);
        const openingCount = result.split(opener).length - 1;
        const closingCount = result.split(last).length - 1;
        if (closingCount <= openingCount) break;
        result = result.slice(0, -1);
    }

    return result;
}

function overlapsRange(ranges: readonly HighlightRange[], start: number, end: number): boolean {
    return ranges.some((range) => start < range.end && end > range.start);
}

function addRange(
    ranges: HighlightRange[],
    start: number,
    rawText: string,
    kind: "url" | "filepath",
    style: string,
): void {
    const text = trimMatchEnd(rawText, kind);
    if (text.length === 0) return;

    const end = start + text.length;
    if (overlapsRange(ranges, start, end)) return;
    ranges.push({ start, end, style });
}

function collectHighlightRanges(plainText: string, styles: HighlightStyles): HighlightRange[] {
    const ranges: HighlightRange[] = [];

    for (const match of plainText.matchAll(URL_REGEX)) {
        if (match.index === undefined) continue;
        addRange(ranges, match.index, match[0], "url", styles.url);
    }

    for (const match of plainText.matchAll(FILEPATH_REGEX)) {
        if (match.index === undefined) continue;
        const prefix = match[1] ?? "";
        const filepath = match[2];
        if (filepath === undefined) continue;
        addRange(ranges, match.index + prefix.length, filepath, "filepath", styles.filepath);
    }

    return ranges.sort((left, right) => left.start - right.start);
}

function restoreForeground(foreground: string | undefined): string {
    return foreground ?? DEFAULT_FOREGROUND;
}

function appendTextWithHighlights(
    output: string[],
    token: TextToken,
    ranges: readonly HighlightRange[],
): void {
    let tokenOffset = 0;

    for (const range of ranges) {
        if (range.end <= token.plainStart) continue;
        if (range.start >= token.plainEnd) break;

        const highlightStart = Math.max(range.start, token.plainStart) - token.plainStart;
        const highlightEnd = Math.min(range.end, token.plainEnd) - token.plainStart;

        if (highlightStart > tokenOffset) {
            output.push(token.text.slice(tokenOffset, highlightStart));
        }

        output.push(range.style);
        output.push(token.text.slice(highlightStart, highlightEnd));
        output.push(restoreForeground(token.foreground));
        tokenOffset = highlightEnd;
    }

    if (tokenOffset < token.text.length) {
        output.push(token.text.slice(tokenOffset));
    }
}

export function highlightMessageLine(line: string, styles: HighlightStyles): string {
    if (line.length === 0) return line;

    const { tokens, plainText } = tokenizeAnsi(line);
    const ranges = collectHighlightRanges(plainText, styles);
    if (ranges.length === 0) return line;

    const output: string[] = [];
    for (const token of tokens) {
        if (token.kind === "control") {
            output.push(token.text);
        } else {
            appendTextWithHighlights(output, token, ranges);
        }
    }

    return output.join("");
}

export function highlightMessageLines(lines: readonly string[], styles: HighlightStyles): string[] {
    return lines.map((line) => highlightMessageLine(line, styles));
}

export function getStylePrefix(styleFn: (text: string) => string): string {
    const sentinel = "\u0000";
    const styled = styleFn(sentinel);
    const sentinelIndex = styled.indexOf(sentinel);
    if (sentinelIndex < 0) return "";
    return styled.slice(0, sentinelIndex);
}
