import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    installLiveFooter,
    patchFooterReset,
    rememberFooterForTransition,
} from "./footer-transition.ts";
import { patchTuiShrinkRedraw } from "./tui-shrink-redraw.ts";

export default function uiEnhancements(pi: ExtensionAPI) {
    patchFooterReset();
    patchTuiShrinkRedraw();

    const getThinkingLevel = () => pi.getThinkingLevel();

    const installFooter = (ctx: ExtensionContext) => {
        installLiveFooter(ctx, getThinkingLevel);
    };

    pi.on("session_start", async (_event, ctx) => {
        installFooter(ctx);
    });

    pi.on("session_shutdown", async (event, ctx) => {
        rememberFooterForTransition(ctx, event.reason, getThinkingLevel());
    });
}
