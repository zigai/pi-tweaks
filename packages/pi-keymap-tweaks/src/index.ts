import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { applyKeymapEditor } from "./editor-keymap.ts";
import { applySubmitModeKeymap } from "./submit-mode-patch.ts";

let editorHandle: { dispose(): void } | undefined;
let submitModeHandle: { dispose(): void } | undefined;

export default function piKeymap(pi: ExtensionAPI): void {
    submitModeHandle?.dispose();
    submitModeHandle = applySubmitModeKeymap();

    pi.on("session_start", async (_event, ctx) => {
        editorHandle?.dispose();
        editorHandle = applyKeymapEditor(ctx, {
            notify: (message, type) => ctx.ui.notify(message, type),
        });
    });
    pi.on("session_shutdown", () => {
        editorHandle?.dispose();
        editorHandle = undefined;
        submitModeHandle?.dispose();
        submitModeHandle = undefined;
    });
}
