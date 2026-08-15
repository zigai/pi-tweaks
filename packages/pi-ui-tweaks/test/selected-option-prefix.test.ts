import assert from "node:assert/strict";
import { SelectList } from "@earendil-works/pi-tui";
import { test } from "vitest";

import { installSelectedOptionPrefixSelectListPatch } from "../src/selected-option-prefix.ts";

function createList(): SelectList {
    return new SelectList(
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
}

test("selected option prefix updates generic select-list markers", () => {
    const handle = installSelectedOptionPrefixSelectListPatch({ selectedOptionPrefix: "▌" });
    assert.equal(
        createList().render(80)[0],
        "▌ settings                        Open settings menu",
    );

    handle.update({ selectedOptionPrefix: "→ " });
    assert.equal(createList().render(80)[0]?.startsWith("→ settings"), true);
    handle.dispose();
});
