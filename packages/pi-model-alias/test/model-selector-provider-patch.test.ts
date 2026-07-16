import assert from "node:assert/strict";
import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
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
        loadSettings() {
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

test("model selector provider patch uses the latest runtime state after reinstall", () => {
    const prototype: ModelSelectorPrototype = {
        loadModelsFromSnapshot() {},
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

    target.loadModelsFromSnapshot();

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
        loadModelsFromSnapshot() {},
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

test("model selector patch matches the Pi 0.80.9 runtime prototype", () => {
    installModelSelectorProviderPatch(runtimeState("Provider"));

    assert.equal(
        Reflect.get(
            ModelSelectorComponent.prototype,
            Symbol.for("zigai.pi-model-alias.model-selector-provider-patched"),
        ),
        true,
    );
});
