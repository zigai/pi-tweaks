import {
    ModelRegistry,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { installProviderAliasUiPatches } from "./model-selector-patch.ts";
import {
    aliasForProviderRequest,
    isProviderPayloadObject,
    rewritePayloadModel,
} from "./provider-payload.ts";
import {
    installRegistryPatch,
    loadConfigForRegistry,
    reportConfigError,
    type ModelAliasRuntimeState,
} from "./registry-patch.ts";
import { loadModelAliasSettings, type ModelAliasSettingsLoadState } from "./settings.ts";

type ModelAliasExtensionState = ModelAliasRuntimeState & ModelAliasSettingsLoadState;

function setConfigContext(state: ModelAliasExtensionState, ctx: ExtensionContext): void {
    const projectTrusted = ctx.isProjectTrusted();
    if (state.configCwd !== ctx.cwd || state.projectTrusted !== projectTrusted) {
        state.configCache = undefined;
    }
    state.configCwd = ctx.cwd;
    state.projectTrusted = projectTrusted;
}

export default async function modelAliasExtension(pi: ExtensionAPI): Promise<void> {
    const state: ModelAliasExtensionState = {
        loadSettings: () => loadModelAliasSettings(state),
    };

    installRegistryPatch(ModelRegistry.prototype, state);
    await installProviderAliasUiPatches(state);

    pi.on("session_start", async (_event, ctx) => {
        setConfigContext(state, ctx);
        const registry = ctx.modelRegistry;
        installRegistryPatch(registry, state);
        reportConfigError(state, ctx, loadConfigForRegistry(state, registry, true));
    });

    pi.on("turn_start", (_event, ctx) => {
        setConfigContext(state, ctx);
        reportConfigError(state, ctx, loadConfigForRegistry(state, ctx.modelRegistry, true));
    });

    pi.on("before_provider_request", (event, ctx) => {
        setConfigContext(state, ctx);
        const loaded = loadConfigForRegistry(state, ctx.modelRegistry, true);
        reportConfigError(state, ctx, loaded);
        if (!isProviderPayloadObject(event.payload)) return undefined;
        const alias = aliasForProviderRequest(event.payload, ctx.model, loaded.settings);
        if (alias === undefined) return undefined;
        return rewritePayloadModel(event.payload, alias.model);
    });
}
