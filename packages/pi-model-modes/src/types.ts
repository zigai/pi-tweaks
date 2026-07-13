import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

export type ModeName = string;

export type ModeSpec = {
    provider?: string;
    modelId?: string;
    thinkingLevel?: ThinkingLevel;
    /**
     * Optional theme color token to use for the editor border.
     * If unset, the default editor border is used unless thinking-derived
     * border colors are enabled in settings.
     */
    color?: ThemeColor;
};

export type DefaultModelSpec = {
    provider: string;
    modelId: string;
    thinkingLevel?: ThinkingLevel;
};

export type ModesFile = {
    version: 1;
    currentMode: ModeName;
    defaultModel?: DefaultModelSpec;
    modes: Record<ModeName, ModeSpec>;
};

export type ModeSpecPatch = {
    provider?: string | null;
    modelId?: string | null;
    thinkingLevel?: ThinkingLevel | null;
    color?: ThemeColor | null;
};

export type ModesPatch = {
    currentMode?: ModeName;
    defaultModel?: DefaultModelSpec | null;
    modes?: Record<ModeName, ModeSpecPatch | null>;
};

export type ModeRuntime = {
    filePath: string;
    fileMtimeMs: number | null;
    /**
     * Snapshot of what we last loaded or synced from disk. Used to compute patches
     * so multiple running pi processes do not clobber each other's edits.
     */
    baseline: ModesFile | null;
    data: ModesFile;
    /**
     * Last non-overlay mode. Used as cycle base while in the overlay custom mode.
     */
    lastRealMode: string;
    /**
     * The effective current mode. Can temporarily be the overlay custom mode,
     * which is not persisted and not selectable via /mode.
     */
    currentMode: string;
    applying: boolean;
};
