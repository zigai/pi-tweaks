import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const DEFAULT_MODE_ORDER = ["default"] as const;
export const CUSTOM_MODE_NAME = "custom" as const;

export const MODE_UI_CONFIGURE = "Configure modes…";
export const MODE_UI_ADD = "Add mode…";
export const MODE_UI_SHOW_NAME_ON = "Show mode name: on";
export const MODE_UI_SHOW_NAME_OFF = "Show mode name: off";
export const MODE_UI_BACK = "Back";

export const ALL_THINKING_LEVELS: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
];
export const THINKING_UNSET_LABEL = "(don't change)";
