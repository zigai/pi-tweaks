import assert from "node:assert/strict";
import { test } from "vitest";

type AutocompletePositionPatchTarget = {
    render(width: number): string[];
    autocompleteState?: unknown;
    autocompleteList?: { getSelectedItem?(): unknown; render(width: number): string[] };
    autocompletePrefix?: string;
    autocompleteProvider?: unknown;
    handleInput?(data: string): void;
    paddingX?: number;
    tui?: { requestRender(force?: boolean): void };
};

type AutocompletePositionModule = {
    installAutocompletePositionPatch(prototype?: AutocompletePositionPatchTarget): void;
    setAutocompleteAboveInput(enabled: boolean): void;
    setRestoreContentAfterAutocompleteClose(enabled: boolean): void;
};

function getExportedFunction(value: unknown, name: string): (...args: unknown[]) => unknown {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
        throw new Error(`Expected ${name} export`);
    }
    const method: unknown = Reflect.get(value, name) as unknown;
    if (typeof method !== "function") throw new Error(`Expected ${name} export`);
    return (...args) => Reflect.apply(method, value, args) as unknown;
}

async function importAutocompletePositionModule(
    instance: string,
): Promise<AutocompletePositionModule> {
    const moduleUrl = new URL(`../src/autocomplete-position.ts?${instance}`, import.meta.url);
    const module: unknown = await import(/* @vite-ignore */ moduleUrl.href);
    const install = getExportedFunction(module, "installAutocompletePositionPatch");
    const setAbove = getExportedFunction(module, "setAutocompleteAboveInput");
    const setRestore = getExportedFunction(module, "setRestoreContentAfterAutocompleteClose");
    return {
        installAutocompletePositionPatch(prototype): void {
            install(prototype);
        },
        setAutocompleteAboveInput(enabled): void {
            setAbove(enabled);
        },
        setRestoreContentAfterAutocompleteClose(enabled): void {
            setRestore(enabled);
        },
    };
}

function autocompleteTarget(
    prototype: AutocompletePositionPatchTarget,
): AutocompletePositionPatchTarget {
    return {
        ...prototype,
        autocompleteState: {},
        autocompleteList: {
            render() {
                return ["suggestion"];
            },
        },
        paddingX: 0,
    };
}

function waitForImmediate(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
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

test("autocomplete position patch defers forced redraw after above-input autocomplete closes", async () => {
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
    const target: AutocompletePositionPatchTarget = {
        ...prototype,
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
    };

    try {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
        autocompletePosition.installAutocompletePositionPatch(prototype);

        prototype.render.call(target, 20);
        target.autocompleteState = null;
        target.autocompleteList = undefined;
        prototype.render.call(target, 20);

        assert.deepEqual(requestedForces, []);
        await waitForImmediate();

        assert.deepEqual(requestedForces, [true]);
    } finally {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
    }
});

test("autocomplete position patch does not force redraw when a slash command is confirmed", async () => {
    const autocompletePosition = await importAutocompletePositionModule("command-confirm-redraw");
    const requestedForces: Array<boolean | undefined> = [];
    const prototype: AutocompletePositionPatchTarget = {
        render(this: AutocompletePositionPatchTarget) {
            if (this.autocompleteState === null) return ["input"];
            return ["input", "suggestion"];
        },
        handleInput(this: AutocompletePositionPatchTarget): void {
            this.autocompleteState = null;
            this.autocompleteList = undefined;
        },
    };
    const target: AutocompletePositionPatchTarget = {
        ...prototype,
        autocompleteState: {},
        autocompleteList: {
            getSelectedItem() {
                return { value: "model" };
            },
            render() {
                return ["suggestion"];
            },
        },
        autocompletePrefix: "/mod",
        autocompleteProvider: {},
        paddingX: 0,
        tui: {
            requestRender(force?: boolean): void {
                requestedForces.push(force);
            },
        },
    };

    try {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
        autocompletePosition.installAutocompletePositionPatch(prototype);

        prototype.render.call(target, 20);
        prototype.handleInput?.call(target, "\r");
        prototype.render.call(target, 20);
        await waitForImmediate();

        assert.deepEqual(requestedForces, []);
    } finally {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
    }
});

test("autocomplete position patch redraws when above-input rendering is disabled", async () => {
    const autocompletePosition = await importAutocompletePositionModule("disable-redraw");
    const requestedForces: Array<boolean | undefined> = [];
    const prototype: AutocompletePositionPatchTarget = {
        render() {
            return ["input", "suggestion"];
        },
    };
    const target = autocompleteTarget(prototype);
    target.tui = {
        requestRender(force?: boolean): void {
            requestedForces.push(force);
        },
    };

    try {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
        autocompletePosition.installAutocompletePositionPatch(prototype);

        prototype.render.call(target, 20);
        autocompletePosition.setAutocompleteAboveInput(false);
        prototype.render.call(target, 20);
        await waitForImmediate();

        assert.deepEqual(requestedForces, [true]);
    } finally {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
    }
});

test("autocomplete position patch redraws after a failed slash confirmation", async () => {
    const autocompletePosition = await importAutocompletePositionModule("failed-confirm-redraw");
    const requestedForces: Array<boolean | undefined> = [];
    const prototype: AutocompletePositionPatchTarget = {
        render(this: AutocompletePositionPatchTarget) {
            if (this.autocompleteState === null) return ["input"];
            return ["input", "suggestion"];
        },
        handleInput(this: AutocompletePositionPatchTarget): void {
            this.autocompleteState = null;
            this.autocompleteList = undefined;
            throw new Error("command failed");
        },
    };
    const target: AutocompletePositionPatchTarget = {
        ...prototype,
        autocompleteState: {},
        autocompleteList: {
            getSelectedItem() {
                return { value: "model" };
            },
            render() {
                return ["suggestion"];
            },
        },
        autocompletePrefix: "/mod",
        autocompleteProvider: {},
        paddingX: 0,
        tui: {
            requestRender(force?: boolean): void {
                requestedForces.push(force);
            },
        },
    };

    try {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
        autocompletePosition.installAutocompletePositionPatch(prototype);

        prototype.render.call(target, 20);
        assert.throws(() => prototype.handleInput?.call(target, "\r"), /command failed/);
        prototype.render.call(target, 20);
        await waitForImmediate();

        assert.deepEqual(requestedForces, [true]);
    } finally {
        autocompletePosition.setAutocompleteAboveInput(true);
        autocompletePosition.setRestoreContentAfterAutocompleteClose(true);
    }
});
