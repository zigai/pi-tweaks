import assert from "node:assert/strict";
import { test } from "vitest";

import { installSlashCommandSourcePatch } from "../src/slash-command-source.ts";

function interactiveMode() {
    return {
        prefixAutocompleteDescription(description: string | undefined): string | undefined {
            if (description === undefined) return "[source]";
            return `[source] ${description}`;
        },
    };
}

test("slash-command source tags follow live configuration and dispose cleanly", () => {
    const target = interactiveMode();
    const original = Reflect.get(target, "prefixAutocompleteDescription");
    const handle = installSlashCommandSourcePatch({ hideSlashCommandSourceTags: true }, target);
    assert.equal(target.prefixAutocompleteDescription("Open review"), "Open review");

    handle.update({ hideSlashCommandSourceTags: false });
    assert.equal(target.prefixAutocompleteDescription("Open review"), "[source] Open review");

    handle.dispose();
    assert.equal(Reflect.get(target, "prefixAutocompleteDescription"), original);
});
