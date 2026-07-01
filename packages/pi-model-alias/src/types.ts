export type ModelLike = {
    provider: string;
    id: string;
    name?: string;
};

export type AliasConfig = {
    provider: string;
    model: string;
    alias: string;
    name?: string;
};

export type ProviderAliasConfig = {
    provider: string;
    name: string;
};

export type ModelAliasesConfig = {
    aliases?: AliasConfig[];
    providerAliases?: ProviderAliasConfig[];
};

export type LoadedConfig = {
    path: string;
    mtimeMs: number;
    aliases: AliasConfig[];
    providerAliases: ProviderAliasConfig[];
    error?: string;
};

export type RuntimeState = {
    configCache?: LoadedConfig;
    reportedErrorKey?: string;
    loadConfig: () => LoadedConfig;
};

export type BasicModelRegistry = {
    getAll(): ModelLike[];
    getAvailable(): ModelLike[];
    find(provider: string, modelId: string): ModelLike | undefined;
    getProviderDisplayName(provider: string): string;
};
