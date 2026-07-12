import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyModeEditor } from "./editor.ts";
import {
    cycleMode,
    handleModeCommand,
    handleModelSelect,
    handleSessionActivated,
    selectModeUI,
} from "./mode-state.ts";
import { getConfiguredModeShortcuts, setSettingsContext } from "./settings.ts";
import { isShortcutId } from "./shortcut-id.ts";
import { applyThinkingLevelStatusPatch, restoreThinkingLevelStatusPatch } from "./status.ts";

export default function (pi: ExtensionAPI) {
    void applyThinkingLevelStatusPatch();

    const shortcuts = getConfiguredModeShortcuts();
    if (shortcuts.forward !== undefined && isShortcutId(shortcuts.forward)) {
        pi.registerShortcut(shortcuts.forward, {
            description: "Cycle to the next configured mode",
            handler: async (ctx) => {
                await cycleMode(pi, ctx, 1);
            },
        });
    }
    if (shortcuts.backward !== undefined && isShortcutId(shortcuts.backward)) {
        pi.registerShortcut(shortcuts.backward, {
            description: "Cycle to the previous configured mode",
            handler: async (ctx) => {
                await cycleMode(pi, ctx, -1);
            },
        });
    }

    pi.registerCommand("mode", {
        description: "Select prompt mode",
        handler: async (args, ctx) => {
            await handleModeCommand(pi, ctx, args);
        },
    });

    pi.registerShortcut("ctrl+shift+m", {
        description: "Select prompt mode",
        handler: async (ctx) => {
            await selectModeUI(pi, ctx);
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        setSettingsContext(ctx);
        // Install the editor wrapper before loading mode files so startup renders use
        // the configured border color immediately instead of briefly showing Pi's
        // thinking-level border color.
        applyModeEditor(pi, ctx);
        await handleSessionActivated(pi, ctx);
    });

    pi.on("model_select", async (event, ctx) => {
        await handleModelSelect(pi, ctx, event);
    });

    pi.on("session_shutdown", () => {
        restoreThinkingLevelStatusPatch();
    });
}
