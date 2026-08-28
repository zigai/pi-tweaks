import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import modelFilter from "../packages/pi-model-filter/src/index.ts";
import uiTweaks from "../packages/pi-ui-tweaks/src/index.ts";
import modelAlias from "../packages/pi-model-alias/src/index.ts";
import tree from "../packages/pi-tree/src/index.ts";
import footer from "../packages/pi-footer/src/index.ts";
import responseRenderer from "../packages/pi-response-renderer/src/index.ts";
import plainUserMessages from "../packages/pi-plain-user-messages/src/index.ts";
import messageHighlights from "../packages/pi-message-highlights/src/index.ts";
import statusBar from "../packages/pi-status-bar/src/index.ts";
import keymapTweaks from "../packages/pi-keymap-tweaks/src/index.ts";
import modelModes from "../packages/pi-model-modes/src/index.ts";
import promptHistory from "../packages/pi-prompt-history/src/index.ts";
import mentionSkill from "../packages/pi-mention-skill/src/index.ts";
import mentionProject from "../packages/pi-mention-project/src/index.ts";
import trustAllFolders from "../packages/pi-trust-all-folders/src/index.ts";

import { activateTweakFactories, type TweakEntry } from "./activation.ts";

const TWEAKS: readonly TweakEntry[] = [
    { name: "pi-model-filter", factory: modelFilter },
    { name: "pi-ui-tweaks", factory: uiTweaks },
    { name: "pi-model-alias", factory: modelAlias },
    { name: "pi-tree", factory: tree },
    { name: "pi-footer", factory: footer },
    { name: "pi-response-renderer", factory: responseRenderer },
    { name: "pi-plain-user-messages", factory: plainUserMessages },
    { name: "pi-message-highlights", factory: messageHighlights },
    { name: "pi-status-bar", factory: statusBar },
    { name: "pi-keymap-tweaks", factory: keymapTweaks },
    { name: "pi-model-modes", factory: modelModes },
    { name: "pi-prompt-history", factory: promptHistory },
    { name: "pi-mention-skill", factory: mentionSkill },
    { name: "pi-mention-project", factory: mentionProject },
    { name: "pi-trust-all-folders", factory: trustAllFolders },
];

/** Activates every tweak in the established manifest order through one Pi loader boundary. */
export default async function piTweaks(pi: ExtensionAPI): Promise<void> {
    await activateTweakFactories(pi, TWEAKS);
}
