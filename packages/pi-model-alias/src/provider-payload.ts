import { getAliasForLookup } from "./model-aliasing.ts";
import type { AliasConfig, LoadedConfig, ModelLike } from "./types.ts";

function payloadModel(payload: unknown): string | undefined {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return undefined;
    }
    const model: unknown = Object.getOwnPropertyDescriptor(payload, "model")?.value as unknown;
    if (typeof model === "string") {
        return model;
    }
    return undefined;
}

export function rewritePayloadModel(payload: unknown, targetModel: string): unknown {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return payload;
    }
    return {
        ...payload,
        model: targetModel,
    };
}

export function aliasForProviderRequest(
    payload: unknown,
    model: ModelLike | undefined,
    loaded: LoadedConfig,
): AliasConfig | undefined {
    if (model === undefined) {
        return undefined;
    }

    const modelAlias = getAliasForLookup(model.provider, model.id, loaded);
    if (modelAlias !== undefined) {
        return modelAlias;
    }

    const requestModel = payloadModel(payload);
    if (requestModel === undefined || requestModel === model.id) {
        return undefined;
    }

    return getAliasForLookup(model.provider, requestModel, loaded);
}
