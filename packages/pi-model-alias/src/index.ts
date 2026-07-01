import { ModelRegistry, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export default function modelAliasExtension(pi: ExtensionAPI) {
    const state: RuntimeState = {
        loadConfig: () => safeReadConfig(state),
    };

    installRegistryPatch(ModelRegistry.prototype as PatchedModelRegistry, state);
    installProviderAliasUiPatches(state);

    pi.on("session_start", async (_event, ctx) => {
        const registry = ctx.modelRegistry as PatchedModelRegistry;
        installRegistryPatch(registry, state);
        reportConfigError(state, ctx, loadConfigForRegistry(state, registry));
    });

    pi.on("turn_start", (_event, ctx) => {
        reportConfigError(
            state,
            ctx,
            loadConfigForRegistry(state, ctx.modelRegistry as PatchedModelRegistry),
        );
    });

    pi.on("before_provider_request", (event, ctx) => {
        const loaded = loadConfigForRegistry(state, ctx.modelRegistry as PatchedModelRegistry);
        reportConfigError(state, ctx, loaded);
        const alias = aliasForProviderRequest(event.payload, ctx.model, loaded);
        if (alias === undefined) {
            return undefined;
        }
        return rewritePayloadModel(event.payload, alias.model);
    });
}
