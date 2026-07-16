import type { AliasConfig, LoadedConfig, ModelLike } from "./types.ts";

function buildModelIdSetByProvider(models: ModelLike[]): Map<string, Set<string>> {
    const modelIds = new Map<string, Set<string>>();
    for (const model of models) {
        let providerModels = modelIds.get(model.provider);
        if (providerModels === undefined) {
            providerModels = new Set<string>();
            modelIds.set(model.provider, providerModels);
        }
        providerModels.add(model.id);
    }
    return modelIds;
}

export function getAliasModelIdCollision(
    aliases: AliasConfig[],
    nativeModels: ModelLike[],
): string | undefined {
    const modelIdsByProvider = buildModelIdSetByProvider(nativeModels);
    for (const alias of aliases) {
        if (modelIdsByProvider.get(alias.provider)?.has(alias.alias) === true) {
            return `alias "${alias.alias}" for provider "${alias.provider}" conflicts with an existing model id; choose an alias that is not already registered by that provider.`;
        }
    }
    return undefined;
}

export function resolveAliasesAgainstModels(
    loaded: LoadedConfig,
    nativeModels: ModelLike[],
): LoadedConfig {
    if (loaded.error !== undefined || loaded.aliases.length === 0) {
        return loaded;
    }

    const collision = getAliasModelIdCollision(loaded.aliases, nativeModels);
    if (collision === undefined) {
        return loaded;
    }

    return {
        ...loaded,
        aliases: [],
        error: `Failed to load ${loaded.path}: ${collision}`,
    };
}

export function getAliasForModel(model: ModelLike, loaded: LoadedConfig): AliasConfig | undefined {
    return loaded.aliases.find(
        (alias) => alias.provider === model.provider && alias.model === model.id,
    );
}

export function getAliasForLookup(
    provider: string,
    modelId: string,
    loaded: LoadedConfig,
): AliasConfig | undefined {
    return loaded.aliases.find((alias) => alias.provider === provider && alias.alias === modelId);
}

export function applyAlias(model: ModelLike, alias: AliasConfig): ModelLike {
    const aliased: ModelLike = {
        ...model,
        id: alias.alias,
    };
    if (alias.name !== undefined) {
        aliased.name = alias.name;
    }
    return aliased;
}

export function aliasModels(models: ModelLike[], loaded: LoadedConfig): ModelLike[] {
    if (loaded.error !== undefined || loaded.aliases.length === 0) {
        return models;
    }

    return models.map((model) => {
        const alias = getAliasForModel(model, loaded);
        if (alias === undefined) {
            return model;
        }
        return applyAlias(model, alias);
    });
}
