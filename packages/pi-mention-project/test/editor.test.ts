import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { applyMentionSkillEditor } from "../../pi-mention-skill/src/editor.ts";
import { applyMentionProjectEditor } from "../src/editor.ts";
import type { EditorFactory, EditorLike } from "../src/types.ts";

class FakeEditor implements EditorLike {
    text = "";
    autocompleteTriggers = 0;
    renderCalls = 0;

    getText(): string {
        return this.text;
    }

    handleInput(_data: string): void {}

    render(_width: number): string[] {
        this.renderCalls += 1;
        return [this.text];
    }

    isShowingAutocomplete(): boolean {
        return false;
    }

    tryTriggerAutocomplete(): void {
        this.autocompleteTriggers += 1;
    }
}

type EditorContext = {
    ctx: ExtensionContext;
    getFactory: () => EditorFactory | undefined;
};

function contextWithFactory(baseFactory: EditorFactory): EditorContext {
    let currentFactory: EditorFactory | undefined = baseFactory;
    const ui = {
        getEditorComponent(): EditorFactory | undefined {
            return currentFactory;
        },
        setEditorComponent(factory: EditorFactory | undefined): void {
            currentFactory = factory;
        },
        theme: {
            fg(_color: string, value: string): string {
                return value;
            },
        },
    };

    return {
        ctx: { hasUI: true, ui } as unknown as ExtensionContext,
        getFactory: () => currentFactory,
    };
}

function createEditor(factory: EditorFactory): FakeEditor {
    const editor = factory(undefined as never, undefined as never, undefined as never);
    return editor as unknown as FakeEditor;
}

test("applyMentionProjectEditor replaces its enhancer instead of stacking hooks", () => {
    let editor = new FakeEditor();
    const baseFactory = (() => {
        editor = new FakeEditor();
        editor.text = "Please inspect #gameops";
        return editor;
    }) as unknown as EditorFactory;
    const { ctx, getFactory } = contextWithFactory(baseFactory);
    let projectNameSnapshotCalls = 0;
    const getProjectNames = (): ReadonlySet<string> => {
        projectNameSnapshotCalls += 1;
        return new Set(["gameops"]);
    };

    applyMentionProjectEditor(ctx, "#", getProjectNames);
    applyMentionProjectEditor(ctx, "#", getProjectNames);

    const factory = getFactory();
    assert.ok(factory);
    const enhanced = createEditor(factory);
    enhanced.handleInput("g");
    enhanced.render(80);

    assert.equal(editor.autocompleteTriggers, 1);
    assert.equal(projectNameSnapshotCalls, 1);
});

test("mention project and skill editors share one enhancer registry", () => {
    let editor = new FakeEditor();
    const baseFactory = (() => {
        editor = new FakeEditor();
        return editor;
    }) as unknown as EditorFactory;
    const { ctx, getFactory } = contextWithFactory(baseFactory);

    applyMentionProjectEditor(ctx, "#", () => new Set(["gameops"]));
    applyMentionSkillEditor(ctx, "$", () => new Set(["typescript"]));
    applyMentionProjectEditor(ctx, "#", () => new Set(["gameops"]));
    applyMentionSkillEditor(ctx, "$", () => new Set(["typescript"]));

    const factory = getFactory();
    assert.ok(factory);
    const enhanced = createEditor(factory);

    editor.text = "Please inspect #gameops";
    enhanced.handleInput("g");
    assert.equal(editor.autocompleteTriggers, 1);

    editor.text = "Use $typescript";
    enhanced.handleInput("t");
    assert.equal(editor.autocompleteTriggers, 2);
});
