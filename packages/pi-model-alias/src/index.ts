import {
    ModelRegistry,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { safeReadConfig } from "./config.ts";
import { installProviderAliasUiPatches } from "./model-selector-provider-patch.ts";
import { aliasForProviderRequest, rewritePayloadModel } from "./provider-payload.ts";
import {
    installRegistryPatch,
    loadConfigForRegistry,
    type PatchedModelRegistry,
    reportConfigError,
} from "./registry-patch.ts";
import type { RuntimeState } from "./types.ts";

type ProjectTrustContext = ExtensionContext & {
    isProjectTrusted?: () => boolean;
};

function isProjectTrusted(ctx: ExtensionContext): boolean {
    return (ctx as ProjectTrustContext).isProjectTrusted?.() ?? true;
}

function setConfigContext(state: RuntimeState, ctx: ExtensionContext): void {
    const projectTrusted = isProjectTrusted(ctx);
    if (state.configCwd !== ctx.cwd || state.projectTrusted !== projectTrusted) {
        state.configCache = undefined;
    }
    state.configCwd = ctx.cwd;
    state.projectTrusted = projectTrusted;
}

export default async function modelAliasExtension(pi: ExtensionAPI): Promise<void> {
    const state: RuntimeState = {
        loadConfig: () => safeReadConfig(state),
    };

    installRegistryPatch(ModelRegistry.prototype as PatchedModelRegistry, state);
    await installProviderAliasUiPatches(state);

    pi.on("session_start", async (_event, ctx) => {
        setConfigContext(state, ctx);
        const registry = ctx.modelRegistry as PatchedModelRegistry;
        installRegistryPatch(registry, state);
        reportConfigError(state, ctx, loadConfigForRegistry(state, registry));
    });

    pi.on("turn_start", (_event, ctx) => {
        setConfigContext(state, ctx);
        reportConfigError(
            state,
            ctx,
            loadConfigForRegistry(state, ctx.modelRegistry as PatchedModelRegistry),
        );
    });

    pi.on("before_provider_request", (event, ctx) => {
        setConfigContext(state, ctx);
        const loaded = loadConfigForRegistry(state, ctx.modelRegistry as PatchedModelRegistry);
        reportConfigError(state, ctx, loaded);
        const alias = aliasForProviderRequest(event.payload, ctx.model, loaded);
        if (alias === undefined) {
            return undefined;
        }
        return rewritePayloadModel(event.payload, alias.model);
    });
}
