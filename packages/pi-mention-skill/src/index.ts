import {
    CustomEditor,
    type ExtensionAPI,
    type ExtensionContext,
    type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
    type AutocompleteItem,
    type AutocompleteProvider,
    type AutocompleteSuggestions,
    fuzzyFilter,
} from "@earendil-works/pi-tui";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_SUGGESTIONS = 20;
const SKILL_COMMAND_PREFIX = "skill:";
const SKILL_MENTION_PATTERN = /(^|\s)\$([a-z0-9][a-z0-9-]{0,63})(?=$|\s|[.,;:!?)}\]])/g;
const MENTION_FACTORY_BASE = Symbol.for("zigai.pi-mention-skill.editor-factory-base");

type SkillCommand = SlashCommandInfo & {
    name: `skill:${string}`;
    description: string;
};

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

type EditorLike = {
    getText(): string;
    handleInput(data: string): void;
    render(width: number): string[];
    isShowingAutocomplete?(): boolean;
    tryTriggerAutocomplete?(explicitTab?: boolean): void;
};

type WrappedEditorFactory = EditorFactory & {
    [MENTION_FACTORY_BASE]?: EditorFactory | undefined;
};

type SkillExpansion = {
    name: string;
    location: string;
    body: string;
    baseDir: string;
};

function stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;

    const end = content.indexOf("\n---", 3);
    if (end === -1) return content;

    const afterMarker = end + "\n---".length;
    if (content[afterMarker] === "\r" && content[afterMarker + 1] === "\n") {
        return content.slice(afterMarker + 2);
    }
    if (content[afterMarker] === "\n") {
        return content.slice(afterMarker + 1);
    }
    return content.slice(afterMarker);
}

function getSkillCommands(pi: ExtensionAPI): SkillCommand[] {
    return pi.getCommands().filter((command): command is SkillCommand => {
        return command.source === "skill" && command.name.startsWith(SKILL_COMMAND_PREFIX);
    });
}

function skillName(command: SkillCommand): string {
    return command.name.slice(SKILL_COMMAND_PREFIX.length);
}

function skillToItem(command: SkillCommand): AutocompleteItem {
    const name = skillName(command);
    return {
        value: `$${name}`,
        label: `$${name}`,
        description: command.description,
    };
}

function extractSkillToken(textBeforeCursor: string): string | undefined {
    const match = /(?:^|\s)\$([a-z0-9-]*)$/.exec(textBeforeCursor);
    return match?.[1];
}

function filterSkills(skills: SkillCommand[], query: string): AutocompleteItem[] {
    if (query.length === 0) {
        return skills.slice(0, MAX_SUGGESTIONS).map(skillToItem);
    }

    return fuzzyFilter(skills, query, (skill) => `${skillName(skill)} ${skill.description}`)
        .slice(0, MAX_SUGGESTIONS)
        .map(skillToItem);
}

function filterSlashSkillSuggestions(
    suggestions: AutocompleteSuggestions | null,
): AutocompleteSuggestions | null {
    if (suggestions === null || !suggestions.prefix.startsWith("/")) return suggestions;

    const items = suggestions.items.filter((item) => !item.value.startsWith(SKILL_COMMAND_PREFIX));
    if (items.length === suggestions.items.length) return suggestions;
    if (items.length === 0) return null;
    return { ...suggestions, items };
}

function createSkillMentionProvider(
    pi: ExtensionAPI,
    current: AutocompleteProvider,
): AutocompleteProvider {
    return {
        async getSuggestions(
            lines,
            cursorLine,
            cursorCol,
            options,
        ): Promise<AutocompleteSuggestions | null> {
            const line = lines[cursorLine] ?? "";
            const beforeCursor = line.slice(0, cursorCol);
            const token = extractSkillToken(beforeCursor);
            if (token === undefined) {
                const suggestions = await current.getSuggestions(
                    lines,
                    cursorLine,
                    cursorCol,
                    options,
                );
                return filterSlashSkillSuggestions(suggestions);
            }

            const items = filterSkills(getSkillCommands(pi), token);
            if (items.length === 0) return null;
            return { prefix: `$${token}`, items };
        },

        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
            if (!prefix.startsWith("$")) {
                return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
            }

            const currentLine = lines[cursorLine] ?? "";
            const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
            const afterCursor = currentLine.slice(cursorCol);
            const needsSpace = afterCursor.length === 0 || !/^\s/.test(afterCursor);
            let suffix = "";
            if (needsSpace) {
                suffix = " ";
            }
            const newLines = [...lines];
            newLines[cursorLine] = `${beforePrefix}${item.value}${suffix}${afterCursor}`;
            return {
                lines: newLines,
                cursorLine,
                cursorCol: beforePrefix.length + item.value.length + suffix.length,
            };
        },

        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
            return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
    };
}

function isSkillMentionContext(text: string): boolean {
    return /(?:^|\s)\$[a-z0-9-]*$/.test(text);
}

function colorSkillMentions(line: string, pi: ExtensionAPI, ctx: ExtensionContext): string {
    const skillNames = new Set(getSkillCommands(pi).map(skillName));
    if (skillNames.size === 0 || !line.includes("$")) return line;

    return line.replace(/\$([a-z0-9][a-z0-9-]{0,63})/g, (match: string, name: string) => {
        if (!skillNames.has(name)) return match;
        return ctx.ui.theme.fg("accent", match);
    });
}

const ANSI_ESCAPE_PATTERN = new RegExp(
    `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
    "g",
);

function stripAnsi(value: string): string {
    return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function autocompleteStartIndex(renderedLines: string[]): number {
    for (let index = renderedLines.length - 1; index >= 0; index -= 1) {
        const line = renderedLines[index];
        if (line !== undefined && stripAnsi(line).startsWith("─")) return index + 1;
    }
    return renderedLines.length;
}

function enhanceEditor(editor: EditorLike, pi: ExtensionAPI, ctx: ExtensionContext): EditorLike {
    const originalHandleInput = editor.handleInput.bind(editor);
    editor.handleInput = (data: string) => {
        originalHandleInput(data);

        if (!/^[a-z0-9-$]$/i.test(data)) return;

        const text = editor.getText();
        const lines = text.split("\n");
        const lastLine = lines[lines.length - 1];
        let currentLine = "";
        if (lastLine !== undefined) {
            currentLine = lastLine;
        }
        if (!isSkillMentionContext(currentLine)) return;
        if (editor.isShowingAutocomplete?.() === true) return;
        editor.tryTriggerAutocomplete?.();
    };

    const originalRender = editor.render.bind(editor);
    editor.render = (width: number) => {
        const renderedLines = originalRender(width);
        let colorThrough = renderedLines.length;
        if (editor.isShowingAutocomplete?.() === true) {
            colorThrough = autocompleteStartIndex(renderedLines);
        }
        return renderedLines.map((line, index) => {
            if (index >= colorThrough) return line;
            return colorSkillMentions(line, pi, ctx);
        });
    };

    return editor;
}

function applyMentionSkillEditor(pi: ExtensionAPI, ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    const existing = ctx.ui.getEditorComponent() as WrappedEditorFactory | undefined;
    const baseFactory = existing?.[MENTION_FACTORY_BASE] ?? existing;
    const factory = ((tui, theme, keybindings) => {
        const editor = (baseFactory?.(tui, theme, keybindings) ??
            new CustomEditor(tui, theme, keybindings)) as unknown as EditorLike;
        return enhanceEditor(editor, pi, ctx);
    }) as WrappedEditorFactory;
    factory[MENTION_FACTORY_BASE] = baseFactory;

    ctx.ui.setEditorComponent(factory);
}

async function loadSkillExpansion(command: SkillCommand): Promise<SkillExpansion> {
    const content = await fs.readFile(command.sourceInfo.path, "utf8");
    const body = stripFrontmatter(content).trim();
    const baseDir = command.sourceInfo.baseDir ?? path.dirname(command.sourceInfo.path);
    const name = skillName(command);
    return { name, location: command.sourceInfo.path, body, baseDir };
}

function formatSkillBlock(expansion: SkillExpansion): string {
    return `<skill name="${expansion.name}" location="${expansion.location}">\nReferences are relative to ${expansion.baseDir}.\n\n${expansion.body}\n</skill>`;
}

function formatCombinedSkillBlock(expansions: SkillExpansion[]): string {
    if (expansions.length === 1) {
        const expansion = expansions[0];
        if (expansion !== undefined) return formatSkillBlock(expansion);
    }

    const names = expansions.map((expansion) => expansion.name).join(", ");
    const content = expansions
        .map((expansion) => {
            return `## ${expansion.name}\n\nReferences are relative to ${expansion.baseDir}.\n\n${expansion.body}`;
        })
        .join("\n\n---\n\n");
    return `<skill name="${names}" location="multiple">\n${content}\n</skill>`;
}

function removeSkillMentionSigils(text: string, names: Set<string>): string {
    return text
        .replace(SKILL_MENTION_PATTERN, (match: string, leading: string, name: string) => {
            if (!names.has(name)) return match;
            return `${leading}${name}`;
        })
        .trim();
}

async function expandSkillMentions(text: string, skills: SkillCommand[]): Promise<string> {
    const byName = new Map(skills.map((skill) => [skillName(skill), skill]));
    const names = new Set<string>();

    for (const match of text.matchAll(SKILL_MENTION_PATTERN)) {
        const name = match[2];
        if (name !== undefined && byName.has(name)) {
            names.add(name);
        }
    }

    if (names.size === 0) return text;

    const expansions = await Promise.all(
        [...names].map(async (name) => {
            const skill = byName.get(name);
            if (skill === undefined) return undefined;
            return loadSkillExpansion(skill);
        }),
    );
    const loaded = expansions.filter((expansion): expansion is SkillExpansion => {
        return expansion !== undefined;
    });
    if (loaded.length === 0) return text;

    const skillBlock = formatCombinedSkillBlock(loaded);
    const userMessage = removeSkillMentionSigils(text, names);
    if (userMessage.length === 0) return skillBlock;
    return `${skillBlock}\n\n${userMessage}`;
}

export default function (pi: ExtensionAPI): void {
    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI) return;
        applyMentionSkillEditor(pi, ctx);
        ctx.ui.addAutocompleteProvider((current) => createSkillMentionProvider(pi, current));
    });

    pi.on("input", async (event) => {
        if (!event.text.includes("$")) return { action: "continue" };

        const expanded = await expandSkillMentions(event.text, getSkillCommands(pi));
        if (expanded === event.text) return { action: "continue" };
        return { action: "transform", text: expanded, images: event.images };
    });
}
