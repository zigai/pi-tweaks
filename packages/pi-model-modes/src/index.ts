import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { applyModeEditor } from "./editor.ts";
import { ModeController } from "./mode-controller.ts";
import { ModePicker, registerModeSelectorShortcuts } from "./mode-picker.ts";
import { getConfiguredModeShortcuts, shouldShowThinkingLevelStatus } from "./settings.ts";
import { isShortcutId } from "./shortcut-id.ts";
import { applyThinkingLevelStatusPatch } from "./status.ts";

export default function (pi: ExtensionAPI) {
    const controller = new ModeController(pi);
    const picker = new ModePicker(controller);
    let settingsContext = { cwd: process.cwd(), projectTrusted: false };
    let restoreStatusPatch = (): void => {};
    let editorHandle: { dispose(): void } | undefined;
    void applyThinkingLevelStatusPatch({
        shouldShowThinkingLevelStatus: () => shouldShowThinkingLevelStatus(settingsContext),
    }).then((restore) => {
        restoreStatusPatch = restore;
    });

    const shortcuts = getConfiguredModeShortcuts(settingsContext);
    if (shortcuts.forward !== undefined && isShortcutId(shortcuts.forward)) {
        pi.registerShortcut(shortcuts.forward, {
            description: "Cycle to the next configured mode",
            handler: (ctx) => controller.cycle(ctx, 1),
        });
    }
    if (shortcuts.backward !== undefined && isShortcutId(shortcuts.backward)) {
        pi.registerShortcut(shortcuts.backward, {
            description: "Cycle to the previous configured mode",
            handler: (ctx) => controller.cycle(ctx, -1),
        });
    }

    pi.registerCommand("mode", {
        description: "Select prompt mode",
        handler: (args, ctx) => picker.handleCommand(ctx, args),
    });
    registerModeSelectorShortcuts(pi, (ctx) => picker.select(ctx));

    pi.on("session_start", async (event, ctx) => {
        settingsContext = controller.getSettingsContext(ctx);
        // Install the editor wrapper before loading mode files so startup renders use
        // the configured border color immediately.
        editorHandle?.dispose();
        editorHandle = applyModeEditor(controller, ctx);
        await controller.handleSessionActivated(ctx, event);
    });
    pi.on("model_select", (event, ctx) => controller.handleModelSelect(ctx, event));
    pi.on("session_shutdown", () => {
        restoreStatusPatch();
        editorHandle?.dispose();
        editorHandle = undefined;
    });
}
