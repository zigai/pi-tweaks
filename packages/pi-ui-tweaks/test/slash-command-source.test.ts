import assert from "node:assert/strict";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { test } from "vitest";

import { installSlashCommandSourcePatch } from "../src/slash-command-source.ts";

function interactiveMode() {
    return {
        prefixAutocompleteDescription: (description: string | undefined): string | undefined => {
            if (description === undefined) return "[source]";
            return `[source] ${description}`;
        },
    };
}

test("explicit null does not patch Pi's default slash-command formatter", () => {
    const original = Object.getOwnPropertyDescriptor(
        InteractiveMode.prototype,
        "prefixAutocompleteDescription",
    );
    const handle = installSlashCommandSourcePatch({ hideSlashCommandSourceTags: true }, null);

    assert.deepEqual(
        Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "prefixAutocompleteDescription"),
        original,
    );
    handle.dispose();
});

test("slash-command source tags follow live configuration and dispose cleanly", () => {
    const target = interactiveMode();
    const original = target.prefixAutocompleteDescription;
    const handle = installSlashCommandSourcePatch({ hideSlashCommandSourceTags: true }, target);
    assert.equal(target.prefixAutocompleteDescription("Open review"), "Open review");

    handle.update({ hideSlashCommandSourceTags: false });
    assert.equal(target.prefixAutocompleteDescription("Open review"), "[source] Open review");

    handle.dispose();
    assert.equal(target.prefixAutocompleteDescription, original);
});
