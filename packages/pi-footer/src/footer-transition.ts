import {
    InteractiveMode,
    type ExtensionContext,
    type SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";

import { markFooterComponent, getFooterComponentKind } from "./footer-component.ts";
import { createFooterComponent, type PlainFooterTheme } from "./footer-rendering.ts";
import type { FooterConfig } from "./settings.ts";
import type { ContextUsage, FooterContext, FooterData, FooterModel } from "./types.ts";

const RESET_PATCH_MARKER = Symbol.for("zigai.pi-footer.reset-extension-ui-patch");
const RESET_PATCH_STATE = Symbol.for("zigai.pi-footer.reset-extension-ui-patch-state");
const TRANSITION_STATE_KEY = "__zigaiPiFooterTransitionState__";
const BRIDGE_FOOTER_TTL_MS = 15_000;

type FooterComponent = ReturnType<typeof createFooterComponent>;
type FooterTui = {
    requestRender(): void;
    setClearOnShrink?(enabled: boolean): void;
};
type FooterFactory = (
    tui: FooterTui,
    theme: PlainFooterTheme,
    footerData: FooterData,
) => FooterComponent;
type LiveFooterContext = FooterContext & {
    ui: {
        setFooter(factory: FooterFactory | undefined): void;
    };
};

type FooterResetHost = {
    customFooter?: unknown;
    resetExtensionUI(): void;
    setExtensionFooter(factory: FooterFactory | undefined): void;
};

type FooterSnapshot = {
    context: FooterContext;
    thinkingLevel: string;
    config: FooterConfig;
};

type FooterTransitionState = {
    latestSnapshot?: FooterSnapshot;
    pendingShutdownReason?: SessionShutdownEvent["reason"];
    liveInstallGeneration: number;
};

type FooterResetPatchState = {
    originalReset: (this: FooterResetHost) => void;
    afterReset: (
        host: FooterResetHost,
        footerKind: string | undefined,
        snapshot: FooterSnapshot | undefined,
        transitionState: FooterTransitionState,
    ) => void;
};

type PatchableInteractiveModePrototype = {
    customFooter?: unknown;
    resetExtensionUI?: (this: FooterResetHost) => void;
    setExtensionFooter?: (this: FooterResetHost, factory: FooterFactory | undefined) => void;
    [RESET_PATCH_MARKER]?: true;
    [RESET_PATCH_STATE]?: FooterResetPatchState;
};

type FooterTransitionGlobal = typeof globalThis & {
    [TRANSITION_STATE_KEY]?: FooterTransitionState;
};

function getTransitionState(): FooterTransitionState {
    const globalState = globalThis as FooterTransitionGlobal;
    let state = globalState[TRANSITION_STATE_KEY];
    if (state === undefined) {
        state = { liveInstallGeneration: 0 };
        globalState[TRANSITION_STATE_KEY] = state;
    }
    return state;
}

function cloneContextUsage(usage: ContextUsage): ContextUsage {
    if (usage === undefined) return undefined;
    return { ...usage };
}

function resolveProviderDisplayName(ctx: FooterContext, provider: string): string | undefined {
    if (ctx.modelRegistry === undefined) return undefined;
    try {
        const displayName = ctx.modelRegistry.getProviderDisplayName(provider);
        if (displayName.length > 0) {
            return displayName;
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function cloneModel(ctx: FooterContext): FooterModel | undefined {
    const model = ctx.model;
    if (model === undefined) return undefined;

    const cloned: FooterModel = {
        provider: model.provider,
        id: model.id,
        contextWindow: model.contextWindow,
    };
    if (model.name !== undefined) {
        cloned.name = model.name;
    }
    const providerDisplayName = resolveProviderDisplayName(ctx, model.provider);
    if (providerDisplayName !== undefined) {
        cloned.providerDisplayName = providerDisplayName;
    }
    return cloned;
}

function cloneMcpServers(ctx: FooterContext): unknown[] | undefined {
    const servers = ctx.mcpServers;
    if (!Array.isArray(servers)) return undefined;

    return Array.from<unknown>({ length: servers.length });
}

function createFooterSnapshot(
    ctx: FooterContext,
    thinkingLevel: string,
    config: FooterConfig,
): FooterSnapshot {
    const usage = cloneContextUsage(ctx.getContextUsage());

    return {
        context: {
            cwd: ctx.cwd,
            model: cloneModel(ctx),
            mcpServers: cloneMcpServers(ctx),
            getContextUsage() {
                return usage;
            },
        },
        thinkingLevel,
        config,
    };
}

function shouldBridgeFooter(kind: string | undefined, state: FooterTransitionState): boolean {
    if (kind !== "live" && kind !== "bridge") return false;
    if (state.latestSnapshot === undefined) return false;
    // Session replacements tear down extension UI after `session_shutdown`, but
    // `/reload` calls `resetExtensionUI()` before the shutdown event. Treat an
    // otherwise-active footer with no pending reason as that pre-shutdown reload
    // reset so Pi's built-in footer is not restored while reload is in progress.
    if (state.pendingShutdownReason === "quit") return false;
    return true;
}

function installBridgeFooter(host: FooterResetHost, snapshot: FooterSnapshot): void {
    const generationAtInstall = getTransitionState().liveInstallGeneration;

    host.setExtensionFooter((tui, theme, footerData) => {
        const component = createFooterComponent(
            snapshot.context,
            footerData,
            () => snapshot.thinkingLevel,
            () => tui.requestRender(),
            snapshot.config,
            theme,
        );
        return markFooterComponent(component, "bridge");
    });

    const timeout = setTimeout(() => {
        const state = getTransitionState();
        if (state.liveInstallGeneration !== generationAtInstall) return;
        if (getFooterComponentKind(host.customFooter) !== "bridge") return;
        host.setExtensionFooter(undefined);
    }, BRIDGE_FOOTER_TTL_MS);
    timeout.unref?.();
}

function bridgeAfterFooterReset(
    host: FooterResetHost,
    footerKind: string | undefined,
    snapshot: FooterSnapshot | undefined,
    state: FooterTransitionState,
): void {
    if (!shouldBridgeFooter(footerKind, state)) return;
    if (snapshot === undefined) return;
    installBridgeFooter(host, snapshot);
}

export function patchFooterReset(): void {
    // Pi resets extension-owned UI between session replacements before the
    // replacement session has emitted session_start. Reinstall a snapshot-backed
    // bridge footer in that same reset call so the built-in footer never paints
    // during the handoff.
    const prototypeValue: unknown = InteractiveMode.prototype;
    if (
        (typeof prototypeValue !== "object" && typeof prototypeValue !== "function") ||
        prototypeValue === null
    ) {
        return;
    }
    const originalResetValue: unknown = Reflect.get(prototypeValue, "resetExtensionUI") as unknown;
    const setExtensionFooterValue: unknown = Reflect.get(
        prototypeValue,
        "setExtensionFooter",
    ) as unknown;
    if (typeof originalResetValue !== "function") return;
    if (typeof setExtensionFooterValue !== "function") return;
    // SAFETY: The guarded Pi InteractiveMode boundary verifies both private methods
    // required by this reset patch before exposing its minimal prototype seam.
    const prototype = prototypeValue as PatchableInteractiveModePrototype;

    const existingPatchState = prototype[RESET_PATCH_STATE];
    if (existingPatchState !== undefined) {
        existingPatchState.afterReset = bridgeAfterFooterReset;
        prototype[RESET_PATCH_MARKER] = true;
        return;
    }

    const originalReset = originalResetValue as FooterResetPatchState["originalReset"];

    const patchState: FooterResetPatchState = {
        originalReset,
        afterReset: bridgeAfterFooterReset,
    };

    prototype.resetExtensionUI = function patchedFooterReset(this: FooterResetHost): void {
        const footerKind = getFooterComponentKind(this.customFooter);
        const state = getTransitionState();
        const snapshot = state.latestSnapshot;

        patchState.originalReset.call(this);
        state.pendingShutdownReason = undefined;
        patchState.afterReset(this, footerKind, snapshot, state);
    };

    prototype[RESET_PATCH_STATE] = patchState;
    prototype[RESET_PATCH_MARKER] = true;
}

export function installLiveFooter(
    ctx: LiveFooterContext,
    getThinkingLevel: () => string,
    config: FooterConfig,
): void {
    ctx.ui.setFooter((tui, theme, footerData) => {
        const component = createFooterComponent(
            ctx,
            footerData,
            getThinkingLevel,
            () => tui.requestRender(),
            config,
            theme,
        );
        return markFooterComponent(component, "live");
    });

    const state = getTransitionState();
    state.latestSnapshot = createFooterSnapshot(ctx, getThinkingLevel(), config);
    state.pendingShutdownReason = undefined;
    state.liveInstallGeneration += 1;
}

export function rememberFooterForTransition(
    ctx: ExtensionContext,
    reason: SessionShutdownEvent["reason"],
    thinkingLevel: string,
    config: FooterConfig,
): void {
    const state = getTransitionState();
    state.pendingShutdownReason = reason;

    if (reason === "quit") {
        state.latestSnapshot = undefined;
        return;
    }

    state.latestSnapshot = createFooterSnapshot(ctx, thinkingLevel, config);
}
