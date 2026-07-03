import assert from "node:assert/strict";
import { test } from "vitest";

import { PATCH_KEY } from "../src/constants.ts";
import { patchTreeSelector } from "../src/patch-tree-selector.ts";
import type { ThemeModule, TreeListInstance, TreeNode, TreeSelectorModule } from "../src/types.ts";

class FakeTreeList implements TreeListInstance {
    filteredNodes = [];
    maxVisibleLines: number | undefined;
    selectedIndex = 0;
    showLabelTimestamps = false;

    handleInput(): void {}

    getStatusLabels(): string {
        return "[all]";
    }

    getEntryDisplayText(_node: TreeNode, _isSelected: boolean): string {
        return "entry";
    }

    render(): string[] {
        return [];
    }
}

class FakeTreeSelectorComponent {
    readonly list = new FakeTreeList();

    getTreeList(): FakeTreeList {
        return this.list;
    }
}

function fakeTreeInternals(
    themeNames: Array<string | undefined>,
): [TreeSelectorModule, ThemeModule] {
    return [
        {
            TreeSelectorComponent: FakeTreeSelectorComponent,
        },
        {
            initTheme(name: string | undefined): void {
                themeNames.push(name);
            },
            theme: {
                fg(_role: string, text: string): string {
                    return text;
                },
                bg(_role: string, text: string): string {
                    return text;
                },
                bold(text: string): string {
                    return text;
                },
            },
        },
    ];
}

test("tree selector patch updates shared settings state after reinstall", async () => {
    const globalState = globalThis as typeof globalThis & { [PATCH_KEY]?: boolean };
    delete globalState[PATCH_KEY];
    const themeNames: Array<string | undefined> = [];

    try {
        await patchTreeSelector({
            async loadTreeInternals() {
                return fakeTreeInternals(themeNames);
            },
            patchTreeHeaderText() {},
            settings: {
                getConfiguredThemeName() {
                    return "old-theme";
                },
                getPersistedMode() {
                    return "off";
                },
                getPersistedPreviewEnabled() {
                    return false;
                },
                getPersistedMaxVisibleLines() {
                    return 7;
                },
                getPersistedPreviewFullHeight() {
                    return true;
                },
                persistMode() {},
                persistPreviewEnabled() {},
            },
        });

        const firstSelector = new FakeTreeSelectorComponent();
        assert.equal(firstSelector.getTreeList().maxVisibleLines, 7);

        await patchTreeSelector({
            async loadTreeInternals() {
                return fakeTreeInternals(themeNames);
            },
            patchTreeHeaderText() {},
            settings: {
                getConfiguredThemeName() {
                    return "new-theme";
                },
                getPersistedMode() {
                    return "absolute";
                },
                getPersistedPreviewEnabled() {
                    return true;
                },
                getPersistedMaxVisibleLines() {
                    return 11;
                },
                getPersistedPreviewFullHeight() {
                    return false;
                },
                persistMode() {},
                persistPreviewEnabled() {},
            },
        });

        const secondSelector = new FakeTreeSelectorComponent();
        assert.equal(secondSelector.getTreeList().maxVisibleLines, 11);
        assert.deepEqual(themeNames, ["old-theme", "new-theme"]);
    } finally {
        delete globalState[PATCH_KEY];
    }
});
