import type { LoadedConfig, ModelLike, ProviderAliasConfig } from "./types.ts";

export type ModelSelectorItem = {
    provider: string;
    id: string;
    model: ModelLike;
};

export function getProviderAlias(
    provider: string,
    loaded: LoadedConfig,
): ProviderAliasConfig | undefined {
    if (loaded.error !== undefined) {
        return undefined;
    }

    return loaded.providerAliases.find((alias) => alias.provider === provider);
}

export function getProviderDisplayName(
    provider: string,
    fallbackName: string,
    loaded: LoadedConfig,
): string {
    const alias = getProviderAlias(provider, loaded);
    if (alias === undefined) {
        return fallbackName;
    }
    return alias.name;
}

export function applyProviderDisplayName(
    item: ModelSelectorItem,
    loaded: LoadedConfig,
): ModelSelectorItem {
    const alias = getProviderAlias(item.model.provider, loaded);
    if (alias === undefined) {
        return item;
    }

    return {
        ...item,
        provider: alias.name,
    };
}

export function applyProviderDisplayNames(
    items: ModelSelectorItem[],
    loaded: LoadedConfig,
): ModelSelectorItem[] {
    if (loaded.error !== undefined || loaded.providerAliases.length === 0) {
        return items;
    }

    return items.map((item) => applyProviderDisplayName(item, loaded));
}
