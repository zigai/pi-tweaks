import assert from "node:assert/strict";
import { test } from "vitest";

import {
    installModelSelectorHintPatch,
    setHideModelProviderHint,
} from "../src/model-selector-hint.ts";
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

test("model selector hint patch removes provider hint and following spacer", () => {
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
    setHideModelProviderHint(false);
    const modelSelector = createTestModelSelector();
    const hint = new TestText(MODEL_PROVIDER_HINT_TEXT);
    const spacer = new Spacer();

    installModelSelectorHintPatch(modelSelector);

    modelSelector.addChild(hint);
    modelSelector.addChild(spacer);

    assert.deepEqual(modelSelector.addedComponents, [hint, spacer]);
});

test("model selector hint patch is idempotent", () => {
    setHideModelProviderHint(true);
    const modelSelector = createTestModelSelector();

    installModelSelectorHintPatch(modelSelector);
    const patchedAddChild: unknown = Reflect.get(modelSelector, "addChild");
    installModelSelectorHintPatch(modelSelector);

    assert.equal(Reflect.get(modelSelector, "addChild"), patchedAddChild);
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
