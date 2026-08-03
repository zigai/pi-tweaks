import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

function defineThinkingLevels<const Levels extends readonly ThinkingLevel[]>(
    levels: Levels & ([ThinkingLevel] extends [Levels[number]] ? unknown : never),
): Levels {
    return levels;
}

export const DEFAULT_MODE_ORDER = ["default"] as const;
export const CUSTOM_MODE_NAME = "custom" as const;

export const MODE_UI_CONFIGURE = "Configure modes…";
export const MODE_UI_ADD = "Add mode…";
export const MODE_UI_DEFAULT_MODEL = "Set default model…";
export const MODE_UI_THINKING_COLORS_ON = "Thinking border colors: on";
export const MODE_UI_THINKING_COLORS_OFF = "Thinking border colors: off";
export const MODE_UI_THINKING_STATUS_ON = "Thinking level status: on";
export const MODE_UI_THINKING_STATUS_OFF = "Thinking level status: off";
export const MODE_UI_BACK = "Back";

export const ALL_THINKING_LEVELS = defineThinkingLevels([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const);
export const THINKING_UNSET_LABEL = "(don't change)";
