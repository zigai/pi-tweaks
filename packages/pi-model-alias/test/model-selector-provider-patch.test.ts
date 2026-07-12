import assert from "node:assert/strict";
import { test } from "vitest";

import {
    installModelSelectorProviderPatch,
    installProviderAliasUiPatches,
    installScopedModelsProviderPatch,
} from "../src/model-selector-provider-patch.ts";
import type { LoadedConfig, RuntimeState } from "../src/types.ts";

type ModelSelectorPrototype = NonNullable<Parameters<typeof installModelSelectorProviderPatch>[1]>;
type ScopedModelsPrototype = Parameters<typeof installScopedModelsProviderPatch>[1];

type ModelSelectorItem = ModelSelectorPrototype["allModels"][number];
type ScopedModelsItem = ScopedModelsPrototype["filteredItems"][number];

function loadedConfig(providerName: string): LoadedConfig {
    return {
        path: "/tmp/pi-model-alias/config.json",
        mtimeMs: 1,
        aliases: [],
        providerAliases: [{ provider: "openai", name: providerName }],
        stableProviderColumn: true,
    };
}

function runtimeState(providerName: string): RuntimeState {
    return {
        loadConfig() {
            return loadedConfig(providerName);
        },
    };
}

function modelItem(): ModelSelectorItem {
    return {
        provider: "openai",
        id: "gpt-5",
        model: { provider: "openai", id: "gpt-5" },
    };
}

function scopedItem(): ScopedModelsItem {
    return {
        fullId: "openai/gpt-5",
        model: { provider: "openai", id: "gpt-5" },
        enabled: true,
    };
}

test("model selector provider patch uses the latest runtime state after reinstall", async () => {
    const prototype: ModelSelectorPrototype = {
        async loadModels() {
            return undefined;
        },
        filterModels() {},
        updateList() {},
        allModels: [],
        scopedModelItems: [],
        activeModels: [],
        filteredModels: [],
        selectedIndex: 0,
        scope: "all",
    };
    installModelSelectorProviderPatch(runtimeState("Old Provider"), prototype);
    installModelSelectorProviderPatch(runtimeState("New Provider"), prototype);

    const target: ModelSelectorPrototype = { ...prototype };
    target.allModels = [modelItem()];
    target.scopedModelItems = [];
    target.activeModels = [];
    target.filteredModels = [];
    target.selectedIndex = 0;
    target.scope = "all";

    await target.loadModels();

    assert.equal(target.allModels[0]?.provider, "New Provider");
    assert.equal(target.filteredModels[0]?.provider, "New Provider");
});

test("scoped models provider patch uses the latest runtime state after reinstall", () => {
    let renderedProviders: string[] = [];
    const prototype: ScopedModelsPrototype = {
        updateList() {
            renderedProviders = this.filteredItems.map((item) => item.model.provider);
        },
        filteredItems: [],
    };
    installScopedModelsProviderPatch(runtimeState("Old Provider"), prototype);
    installScopedModelsProviderPatch(runtimeState("New Provider"), prototype);

    const target: ScopedModelsPrototype = { ...prototype };
    target.filteredItems = [scopedItem()];
    target.selectedIndex = 0;

    target.updateList();

    assert.deepEqual(renderedProviders, ["New Provider"]);
    assert.equal(target.filteredItems[0]?.model.provider, "openai");
});

test("provider alias UI patch waits for scoped selector patch installation", async () => {
    const prototype: ModelSelectorPrototype = {
        async loadModels() {
            return undefined;
        },
        filterModels() {},
        updateList() {},
        allModels: [],
        scopedModelItems: [],
        activeModels: [],
        filteredModels: [],
        selectedIndex: 0,
        scope: "all",
    };
    let finishScopedInstall: (() => void) | undefined;
    const scopedInstallFinished = new Promise<void>((resolve) => {
        finishScopedInstall = resolve;
    });

    const installPromise = installProviderAliasUiPatches(runtimeState("Provider"), {
        modelSelectorPrototype: prototype,
        installScopedModelsProviderPatchFromPi() {
            return scopedInstallFinished;
        },
    });

    const pendingResult = await Promise.race([
        installPromise.then(() => "resolved" as const),
        Promise.resolve("pending" as const),
    ]);
    assert.equal(pendingResult, "pending");

    assert.notEqual(finishScopedInstall, undefined);
    if (finishScopedInstall === undefined) assert.fail("expected scoped install finisher");
    finishScopedInstall();

    await installPromise;
});
