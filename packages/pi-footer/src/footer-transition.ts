import {
    InteractiveMode,
    type ExtensionContext,
    type SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";

import { markFooterComponent, getFooterComponentKind } from "./footer-component.ts";
import { createFooterComponent } from "./footer-rendering.ts";
import type { ContextUsage, FooterContext, FooterData, FooterModel } from "./types.ts";

const RESET_PATCH_MARKER = Symbol.for("zigai.pi-footer.reset-extension-ui-patch");
const RESET_PATCH_STATE = Symbol.for("zigai.pi-footer.reset-extension-ui-patch-state");
const TRANSITION_STATE_KEY = "__zigaiPiFooterTransitionState__";
const BRIDGE_FOOTER_TTL_MS = 15_000;

type FooterComponent = ReturnType<typeof createFooterComponent>;
type FooterFactory = (
    tui: { requestRender(): void },
    theme: unknown,
    footerData: FooterData,
) => FooterComponent;

type FooterResetHost = {
    customFooter?: unknown;
    resetExtensionUI(): void;
    setExtensionFooter(factory: FooterFactory | undefined): void;
};

type FooterSnapshot = {
    context: FooterContext;
    thinkingLevel: string;
};

type MaybeMcpContext = ExtensionContext & {
    mcpServers?: unknown[];
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

function cloneModel(model: ExtensionContext["model"]): FooterModel | undefined {
    if (model === undefined) return undefined;

    return {
        provider: model.provider,
        id: model.id,
        contextWindow: model.contextWindow,
    };
}

function cloneMcpServers(ctx: ExtensionContext): unknown[] | undefined {
    const servers = (ctx as MaybeMcpContext).mcpServers;
    if (!Array.isArray(servers)) return undefined;

    return Array.from<unknown>({ length: servers.length });
}

function createFooterSnapshot(ctx: ExtensionContext, thinkingLevel: string): FooterSnapshot {
    const usage = cloneContextUsage(ctx.getContextUsage());

    return {
        context: {
            cwd: ctx.cwd,
            model: cloneModel(ctx.model),
            mcpServers: cloneMcpServers(ctx),
            getContextUsage() {
                return usage;
            },
        },
        thinkingLevel,
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

    host.setExtensionFooter((tui, _theme, footerData) => {
        const component = createFooterComponent(
            snapshot.context,
            footerData,
            () => snapshot.thinkingLevel,
            () => tui.requestRender(),
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
    const prototype = InteractiveMode.prototype as unknown as PatchableInteractiveModePrototype;

    const existingPatchState = prototype[RESET_PATCH_STATE];
    if (existingPatchState !== undefined) {
        existingPatchState.afterReset = bridgeAfterFooterReset;
        prototype[RESET_PATCH_MARKER] = true;
        return;
    }

    const originalReset = prototype.resetExtensionUI;
    const setExtensionFooter = prototype.setExtensionFooter;
    if (typeof originalReset !== "function") return;
    if (typeof setExtensionFooter !== "function") return;

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

export function installLiveFooter(ctx: ExtensionContext, getThinkingLevel: () => string): void {
    ctx.ui.setFooter((tui, _theme, footerData) => {
        const component = createFooterComponent(ctx, footerData, getThinkingLevel, () =>
            tui.requestRender(),
        );
        return markFooterComponent(component, "live");
    });

    const state = getTransitionState();
    state.latestSnapshot = createFooterSnapshot(ctx, getThinkingLevel());
    state.pendingShutdownReason = undefined;
    state.liveInstallGeneration += 1;
}

export function rememberFooterForTransition(
    ctx: ExtensionContext,
    reason: SessionShutdownEvent["reason"],
    thinkingLevel: string,
): void {
    const state = getTransitionState();
    state.pendingShutdownReason = reason;

    if (reason === "quit") {
        state.latestSnapshot = undefined;
        return;
    }

    state.latestSnapshot = createFooterSnapshot(ctx, thinkingLevel);
}
