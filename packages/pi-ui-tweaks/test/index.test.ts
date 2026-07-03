import assert from "node:assert/strict";
import { test } from "vitest";
import { Input, SelectList } from "@earendil-works/pi-tui";

import {
    installAutocompletePositionPatch,
    setAutocompleteAboveInput,
    setRestoreContentAfterAutocompleteClose,
} from "../src/autocomplete-position.ts";
import {
    installAutocompleteScrollInfoPatch,
    setHideAutocompleteScrollInfo,
} from "../src/autocomplete-scroll-info.ts";
import {
    applyBashExecPromptSpacing,
    setBashExecPromptSpacing,
    type BashExecSpacingEditor,
} from "../src/bash-exec-spacing.ts";
import {
    getInputPromptPrefix,
    installInputPromptPrefixPatch,
    setInputPromptPrefix,
} from "../src/input-prompt-prefix.ts";
import {
    installModelSelectorHintPatch,
    setCompactModelSelector,
    setHideModelProviderHint,
} from "../src/model-selector-hint.ts";
import {
    installModelSelectorProviderBadgePatch,
    setHighlightSelectedModelProvider,
} from "../src/model-selector-provider-badge.ts";
import { installModelStatusPatch, setHideModelChangeStatus } from "../src/model-status.ts";
import {
    getSelectedOptionPrefix,
    installSelectedOptionPrefixSelectListPatch,
    setSelectedOptionPrefix,
} from "../src/selected-option-prefix.ts";
import {
    installSlashCommandSourcePatch,
    setHideSlashCommandSourceTags,
} from "../src/slash-command-source.ts";

const MODEL_PROVIDER_HINT_TEXT =
    "Only showing models from configured providers. Use /login to add providers.";

type RenderedComponent = {
    render(width: number): string[];
    invalidate(): void;
};

type TestModelSelector = {
    addedComponents: RenderedComponent[];
    addChild(component: RenderedComponent): void;
};

type TestInteractiveMode = {
    prefixAutocompleteDescription(
        description: string | undefined,
        sourceInfo: unknown,
    ): string | undefined;
};

type TestStatusMode = {
    statuses: string[];
    showStatus(message: string): void;
};

type TestModelSelectorProviderBadge = {
    filteredModels: Array<{ id: string; provider: string }>;
    listContainer: { children: TestMutableText[] };
    selectedIndex: number;
    updateList(): void;
};

class TestText implements RenderedComponent {
    readonly text: string;

    constructor(text: string) {
        this.text = text;
    }

    render(_width: number): string[] {
        return [];
    }

    invalidate(): void {
        return;
    }
}

class TestMutableText implements RenderedComponent {
    text: string;

    constructor(text: string) {
        this.text = text;
    }

    setText(text: string): void {
        this.text = text;
    }

    render(_width: number): string[] {
        return [this.text];
    }

    invalidate(): void {
        return;
    }
}

class Spacer implements RenderedComponent {
    readonly lines: number;

    constructor(lines = 1) {
        this.lines = lines;
    }

    render(_width: number): string[] {
        return [];
    }

    invalidate(): void {
        return;
    }
}

class TestAutocompleteList {
    render(width: number): string[] {
        return [`menu ${width}`, "choice"];
    }
}

class TestAutocompleteEditor {
    autocompleteState: unknown = "active";
    autocompleteList: TestAutocompleteList | undefined = new TestAutocompleteList();
    renderRequests: Array<boolean | undefined> = [];
    paddingX = 1;
    tui = {
        requestRender: (force?: boolean): void => {
            this.renderRequests.push(force);
        },
    };

    render(_width: number): string[] {
        if (this.autocompleteState === null) {
            return ["top", "input"];
        }
        return ["top", "input", "menu 8", "choice"];
    }
}

class TestEditor implements BashExecSpacingEditor {
    text: string;
    renderRequests = 0;
    handledInput: string[] = [];

    constructor(text = "") {
        this.text = text;
    }

    getCursor(): { line: number; col: number } {
        return { line: 0, col: this.text.length };
    }

    getText(): string {
        return this.text;
    }

    handleInput(data: string): void {
        this.handledInput.push(data);
    }

    insertTextAtCursor(text: string): void {
        this.text += text;
    }

    requestRenderNow(): void {
        this.renderRequests += 1;
    }

    setText(text: string): void {
        this.text = text;
    }
}

function createTestModelSelector(): TestModelSelector {
    return {
        addedComponents: [],
        addChild(component: RenderedComponent): void {
            this.addedComponents.push(component);
        },
    };
}

function createTestInteractiveMode(): TestInteractiveMode {
    return {
        prefixAutocompleteDescription(description: string | undefined, _sourceInfo: unknown) {
            if (description === undefined) {
                return "[source]";
            }
            return `[source] ${description}`;
        },
    };
}

function createTestStatusMode(): TestStatusMode {
    return {
        statuses: [],
        showStatus(message: string) {
            this.statuses.push(message);
        },
    };
}

function createTestModelSelectorProviderBadge(): TestModelSelectorProviderBadge {
    const selectedModelId = "claude-sonnet-4";
    const selectedProvider = "anthropic";
    return {
        filteredModels: [
            { id: "gpt-5", provider: "openai" },
            { id: selectedModelId, provider: selectedProvider },
        ],
        listContainer: { children: [] },
        selectedIndex: 1,
        updateList(): void {
            this.listContainer.children = [
                new TestMutableText(`  gpt-5 <muted>[openai]</muted>`),
                new TestMutableText(
                    `<accent>→ </accent><accent>${selectedModelId}</accent> <muted>[${selectedProvider}]</muted>`,
                ),
            ];
        },
    };
}

const autocompleteSpacerLine = "\x1b[0m \x1b[0m" + " ".repeat(9);

const testTheme = {
    fg(color: string, text: string): string {
        return `<${color}>${text}</${color}>`;
    },
};

test("autocomplete position patch moves active autocomplete rows above input", () => {
    setAutocompleteAboveInput(true);
    installAutocompletePositionPatch(TestAutocompleteEditor.prototype);
    const editor = new TestAutocompleteEditor();

    assert.deepEqual(editor.render(10), [
        autocompleteSpacerLine,
        "menu 8",
        "choice",
        "top",
        "input",
    ]);
});

test("autocomplete position patch leaves render order unchanged when disabled", () => {
    setAutocompleteAboveInput(false);
    installAutocompletePositionPatch(TestAutocompleteEditor.prototype);
    const editor = new TestAutocompleteEditor();

    assert.deepEqual(editor.render(10), ["top", "input", "menu 8", "choice"]);
    setAutocompleteAboveInput(true);
});

test("autocomplete position patch requests redraw after above input autocomplete closes", () => {
    setAutocompleteAboveInput(true);
    setRestoreContentAfterAutocompleteClose(true);
    installAutocompletePositionPatch(TestAutocompleteEditor.prototype);
    const editor = new TestAutocompleteEditor();

    assert.deepEqual(editor.render(10), [
        autocompleteSpacerLine,
        "menu 8",
        "choice",
        "top",
        "input",
    ]);
    editor.autocompleteState = null;

    assert.deepEqual(editor.render(10), ["top", "input"]);
    assert.deepEqual(editor.renderRequests, [undefined]);
});

test("autocomplete position patch can leave close redraw disabled", () => {
    setAutocompleteAboveInput(true);
    setRestoreContentAfterAutocompleteClose(false);
    installAutocompletePositionPatch(TestAutocompleteEditor.prototype);
    const editor = new TestAutocompleteEditor();

    assert.deepEqual(editor.render(10), [
        autocompleteSpacerLine,
        "menu 8",
        "choice",
        "top",
        "input",
    ]);
    editor.autocompleteState = null;

    assert.deepEqual(editor.render(10), ["top", "input"]);
    assert.deepEqual(editor.renderRequests, []);
    setRestoreContentAfterAutocompleteClose(true);
});

test("autocomplete scroll info patch hides count footer by default", () => {
    setHideAutocompleteScrollInfo(true);
    installAutocompleteScrollInfoPatch();
    const list = new SelectList(
        [
            { value: "settings", label: "settings" },
            { value: "model", label: "model" },
            { value: "export", label: "export" },
        ],
        2,
        {
            selectedPrefix: (text) => text,
            selectedText: (text) => text,
            description: (text) => text,
            scrollInfo: (text) => `count:${text}`,
            noMatch: (text) => text,
        },
    );

    assert.deepEqual(list.render(80), ["→ settings", "  model"]);
});

test("autocomplete scroll info patch can leave count footer visible", () => {
    setHideAutocompleteScrollInfo(false);
    installAutocompleteScrollInfoPatch();
    const list = new SelectList(
        [
            { value: "settings", label: "settings" },
            { value: "model", label: "model" },
            { value: "export", label: "export" },
        ],
        2,
        {
            selectedPrefix: (text) => text,
            selectedText: (text) => text,
            description: (text) => text,
            scrollInfo: (text) => `count:${text}`,
            noMatch: (text) => text,
        },
    );

    assert.deepEqual(list.render(80), ["→ settings", "  model", "count:  (1/3)"]);
    setHideAutocompleteScrollInfo(true);
});

test("bash exec prompt spacing inserts a space after empty bang", () => {
    setBashExecPromptSpacing(true);
    const editor = new TestEditor();

    assert.equal(applyBashExecPromptSpacing(editor, "!"), true);

    assert.equal(editor.text, "! ");
    assert.equal(editor.renderRequests, 1);
});

test("bash exec prompt spacing preserves excluded bash prefix", () => {
    setBashExecPromptSpacing(true);
    const editor = new TestEditor("! ");

    assert.equal(applyBashExecPromptSpacing(editor, "!"), true);

    assert.equal(editor.text, "!! ");
    assert.equal(editor.renderRequests, 1);
});

test("bash exec prompt spacing leaves normal input alone when disabled", () => {
    setBashExecPromptSpacing(false);
    const editor = new TestEditor();

    assert.equal(applyBashExecPromptSpacing(editor, "!"), false);

    assert.equal(editor.text, "");
    assert.equal(editor.renderRequests, 0);
    setBashExecPromptSpacing(true);
});

test("input prompt prefix patch changes single-line input marker", () => {
    installInputPromptPrefixPatch();
    setInputPromptPrefix("❯");
    const input = new Input();

    const line = input.render(10)[0] ?? "";

    assert.equal(getInputPromptPrefix(), "❯ ");
    assert.equal(line.startsWith("❯ \u001b[7m"), true);
    setInputPromptPrefix("> ");
});

test("selected option prefix patch changes generic select list marker", () => {
    installSelectedOptionPrefixSelectListPatch();
    setSelectedOptionPrefix("▌");
    const list = new SelectList(
        [{ value: "settings", label: "settings", description: "Open settings menu" }],
        5,
        {
            selectedPrefix: (text) => text,
            selectedText: (text) => text,
            description: (text) => text,
            scrollInfo: (text) => text,
            noMatch: (text) => text,
        },
    );

    assert.equal(getSelectedOptionPrefix(), "▌ ");
    assert.equal(list.render(80)[0], "▌ settings                        Open settings menu");
    setSelectedOptionPrefix("→ ");
});

test("model selector hint patch removes provider hint and following spacer", () => {
    setCompactModelSelector(false);
    setHideModelProviderHint(true);
    const modelSelector = createTestModelSelector();
    const before = new TestText("before");
    const hint = new TestText(`\u001b[33m${MODEL_PROVIDER_HINT_TEXT}\u001b[0m`);
    const spacer = new Spacer();
    const after = new TestText("after");

    installModelSelectorHintPatch(modelSelector);

    modelSelector.addChild(before);
    modelSelector.addChild(hint);
    modelSelector.addChild(spacer);
    modelSelector.addChild(after);

    assert.deepEqual(modelSelector.addedComponents, [before, after]);
});

test("model selector hint patch only skips an immediate spacer", () => {
    setCompactModelSelector(false);
    setHideModelProviderHint(true);
    const modelSelector = createTestModelSelector();
    const hint = new TestText(MODEL_PROVIDER_HINT_TEXT);
    const nonSpacer = new TestText("not spacer");
    const laterSpacer = new Spacer();

    installModelSelectorHintPatch(modelSelector);

    modelSelector.addChild(hint);
    modelSelector.addChild(nonSpacer);
    modelSelector.addChild(laterSpacer);

    assert.deepEqual(modelSelector.addedComponents, [nonSpacer, laterSpacer]);
});

test("model selector hint patch leaves hint visible when disabled", () => {
    setCompactModelSelector(false);
    setHideModelProviderHint(false);
    const modelSelector = createTestModelSelector();
    const hint = new TestText(MODEL_PROVIDER_HINT_TEXT);
    const spacer = new Spacer();

    installModelSelectorHintPatch(modelSelector);

    modelSelector.addChild(hint);
    modelSelector.addChild(spacer);

    assert.deepEqual(modelSelector.addedComponents, [hint, spacer]);
});

test("model selector compact mode removes spacer rows independently", () => {
    setCompactModelSelector(true);
    setHideModelProviderHint(false);
    const modelSelector = createTestModelSelector();
    const before = new TestText("before");
    const spacer = new Spacer();
    const hint = new TestText(MODEL_PROVIDER_HINT_TEXT);

    installModelSelectorHintPatch(modelSelector);

    modelSelector.addChild(before);
    modelSelector.addChild(spacer);
    modelSelector.addChild(hint);

    assert.deepEqual(modelSelector.addedComponents, [before, hint]);
});

test("model selector hint patch is idempotent", () => {
    setCompactModelSelector(true);
    setHideModelProviderHint(true);
    const modelSelector = createTestModelSelector();

    installModelSelectorHintPatch(modelSelector);
    const patchedAddChild: unknown = Reflect.get(modelSelector, "addChild");
    installModelSelectorHintPatch(modelSelector);

    assert.equal(Reflect.get(modelSelector, "addChild"), patchedAddChild);
});

test("model selector provider badge patch highlights selected provider", async () => {
    setHighlightSelectedModelProvider(true);
    const modelSelector = createTestModelSelectorProviderBadge();

    await installModelSelectorProviderBadgePatch(modelSelector, testTheme);
    modelSelector.updateList();

    assert.deepEqual(
        modelSelector.listContainer.children.map((child) => child.text),
        [
            "  gpt-5 <muted>[openai]</muted>",
            "<accent>→ </accent><accent>claude-sonnet-4</accent> <accent>[anthropic]</accent>",
        ],
    );
});

test("model selector provider badge patch leaves selected provider muted when disabled", async () => {
    setHighlightSelectedModelProvider(false);
    const modelSelector = createTestModelSelectorProviderBadge();

    await installModelSelectorProviderBadgePatch(modelSelector, testTheme);
    modelSelector.updateList();

    assert.deepEqual(
        modelSelector.listContainer.children.map((child) => child.text),
        [
            "  gpt-5 <muted>[openai]</muted>",
            "<accent>→ </accent><accent>claude-sonnet-4</accent> <muted>[anthropic]</muted>",
        ],
    );
    setHighlightSelectedModelProvider(true);
});

test("model selector provider badge patch installs before Pi theme initialization", async () => {
    const modelSelector = createTestModelSelectorProviderBadge();
    const originalUpdateList = Reflect.get(modelSelector, "updateList");
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...messages: unknown[]): void => {
        warnings.push(messages);
    };

    try {
        await installModelSelectorProviderBadgePatch(modelSelector);
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(warnings.length, 0);
    assert.notEqual(Reflect.get(modelSelector, "updateList"), originalUpdateList);
});

test("model status patch removes model change status", () => {
    setHideModelChangeStatus(true);
    const statusMode = createTestStatusMode();

    installModelStatusPatch(statusMode);

    statusMode.showStatus("Model: deepseek-v4-flash");
    statusMode.showStatus("Switched to GPT-5");

    assert.deepEqual(statusMode.statuses, ["Switched to GPT-5"]);
});

test("model status patch leaves model change status visible when disabled", () => {
    setHideModelChangeStatus(false);
    const statusMode = createTestStatusMode();

    installModelStatusPatch(statusMode);

    statusMode.showStatus("Model: deepseek-v4-flash");

    assert.deepEqual(statusMode.statuses, ["Model: deepseek-v4-flash"]);
});

test("model status patch is idempotent", () => {
    setHideModelChangeStatus(true);
    const statusMode = createTestStatusMode();

    installModelStatusPatch(statusMode);
    const patchedShowStatus: unknown = Reflect.get(statusMode, "showStatus");
    installModelStatusPatch(statusMode);

    assert.equal(Reflect.get(statusMode, "showStatus"), patchedShowStatus);
});

test("slash command source patch removes source tags", () => {
    setHideSlashCommandSourceTags(true);
    const interactiveMode = createTestInteractiveMode();

    installSlashCommandSourcePatch(interactiveMode);

    assert.equal(interactiveMode.prefixAutocompleteDescription("Open review", {}), "Open review");
});

test("slash command source patch leaves source tags visible when disabled", () => {
    setHideSlashCommandSourceTags(false);
    const interactiveMode = createTestInteractiveMode();

    installSlashCommandSourcePatch(interactiveMode);

    assert.equal(
        interactiveMode.prefixAutocompleteDescription("Open review", {}),
        "[source] Open review",
    );
});

test("slash command source patch is idempotent", () => {
    setHideSlashCommandSourceTags(true);
    const interactiveMode = createTestInteractiveMode();

    installSlashCommandSourcePatch(interactiveMode);
    const patchedPrefix: unknown = Reflect.get(interactiveMode, "prefixAutocompleteDescription");
    installSlashCommandSourcePatch(interactiveMode);

    assert.equal(Reflect.get(interactiveMode, "prefixAutocompleteDescription"), patchedPrefix);
});
