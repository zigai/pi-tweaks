import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyPromptHistoryEditor } from "./editor.ts";

export default function (pi: ExtensionAPI) {
    pi.on("session_start", async (_event, ctx) => {
        await applyPromptHistoryEditor(ctx);
    });
}
