import assert from "node:assert/strict";
import { test } from "vitest";

import {
    applyBashExecPromptSpacing,
    setBashExecPromptSpacing,
    type BashExecSpacingEditor,
} from "../src/bash-exec-spacing.ts";
import {
    installModelSelectorHintPatch,
    setCompactModelSelector,
    setHideModelProviderHint,
} from "../src/model-selector-hint.ts";
import { installModelStatusPatch, setHideModelChangeStatus } from "../src/model-status.ts";
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
