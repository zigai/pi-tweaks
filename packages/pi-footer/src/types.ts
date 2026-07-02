import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type PauseInterval = {
    start: number;
    end?: number;
};

export type LoaderPauseApi = {
    pause(): void;
    resume(): void;
    isPaused(): boolean;
};

export type LoaderPauseGlobal = typeof globalThis & {
    __piLoaderPauseIntervals__?: PauseInterval[];
    __piLoaderPauseDepth__?: number;
};

export type PatchedLoader = {
    message?: string;
    currentFrame?: number;
    dotsIntervalId?: ReturnType<typeof setInterval> | null;
    timeIntervalId?: ReturnType<typeof setInterval> | null;
    ui?: { requestRender(): void } | null;
    messageColorFn?: (text: string) => string;
    setText(text: string): void;
};

export type FooterVariant = "blocks" | "plain";
export type FooterSide = "left" | "right";
export type FooterKey = "path" | "branch" | "provider" | "model" | "thinking" | "mcp" | "context";
export type Rgb = [number, number, number];
export type SegmentColors = { bg: string; fg: string };
export type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;
export type FooterModel = {
    provider: string;
    id: string;
    name?: string;
    contextWindow?: number;
    providerDisplayName?: string;
};
export type ProviderDisplayNameRegistry = {
    getProviderDisplayName(provider: string): string;
};
export type FooterContext = {
    cwd: string;
    model?: FooterModel;
    modelRegistry?: ProviderDisplayNameRegistry;
    mcpServers?: unknown[];
    getContextUsage(): ContextUsage;
};

export type FooterData = {
    getGitBranch(): string | null;
    getExtensionStatuses(): ReadonlyMap<string, string>;
    onBranchChange(callback: () => void): () => void;
};

export type FooterItem = {
    key: FooterKey;
    text: string;
    colors: SegmentColors;
};
