import assert from "node:assert/strict";
import { test } from "vitest";

import type * as AutocompletePositionModule from "../src/autocomplete-position.ts";

type AutocompletePositionPatchTarget = {
    render(width: number): string[];
    autocompleteState?: unknown;
    autocompleteList?: { render(width: number): string[] };
    paddingX?: number;
    tui?: { requestRender(force?: boolean): void };
};

async function importAutocompletePositionModule(
    instance: string,
): Promise<typeof AutocompletePositionModule> {
    const moduleUrl = new URL(`../src/autocomplete-position.ts?${instance}`, import.meta.url);
    const module = await import(/* @vite-ignore */ moduleUrl.href);
    return module as typeof AutocompletePositionModule;
}

function autocompleteTarget(
    prototype: AutocompletePositionPatchTarget,
): AutocompletePositionPatchTarget {
    return Object.assign(Object.create(prototype) as AutocompletePositionPatchTarget, {
        autocompleteState: {},
        autocompleteList: {
            render() {
                return ["suggestion"];
            },
        },
        paddingX: 0,
    });
}

test("autocomplete position patch reads config state updated by a reloaded module", async () => {
    const firstModule = await importAutocompletePositionModule("first-runtime");
    const secondModule = await importAutocompletePositionModule("second-runtime");
    const prototype: AutocompletePositionPatchTarget = {
        render() {
            return ["input", "suggestion"];
        },
    };

    try {
        firstModule.setAutocompleteAboveInput(true);
        firstModule.installAutocompletePositionPatch(prototype);
        assert.deepEqual(prototype.render.call(autocompleteTarget(prototype), 20), [
            "\u001b[0m \u001b[0m                   ",
            "suggestion",
            "input",
        ]);

        secondModule.setAutocompleteAboveInput(false);
        secondModule.installAutocompletePositionPatch(prototype);

        assert.deepEqual(prototype.render.call(autocompleteTarget(prototype), 20), [
            "input",
            "suggestion",
        ]);
    } finally {
        secondModule.setAutocompleteAboveInput(true);
        secondModule.setRestoreContentAfterAutocompleteClose(true);
    }
});

test("autocomplete position patch forces redraw after above-input autocomplete closes", async () => {
    const autocompletePosition = await importAutocompletePositionModule("close-redraw");
    const requestedForces: Array<boolean | undefined> = [];
    const prototype: AutocompletePositionPatchTarget = {
        render(this: AutocompletePositionPatchTarget) {
            if (this.autocompleteState === null) {
                return ["input"];
            }
            return ["input", "suggestion"];
        },
    };
    const target: AutocompletePositionPatchTarget = Object.assign(
        Object.create(prototype) as AutocompletePositionPatchTarget,
        {
            autocompleteState: {},
            autocompleteList: {
                render() {
                    return ["suggestion"];
                },
            },
            paddingX: 0,
            tui: {
                requestRender(force?: boolean): void {
                    requestedForces.push(force);
                },
            },
        },
    );

    try {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
        autocompletePosition.installAutocompletePositionPatch(prototype);

        prototype.render.call(target, 20);
        target.autocompleteState = null;
        target.autocompleteList = undefined;
        prototype.render.call(target, 20);

        assert.deepEqual(requestedForces, [true]);
    } finally {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
    }
});
