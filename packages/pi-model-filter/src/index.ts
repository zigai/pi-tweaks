import {
    CONFIG_DIR_NAME,
    getAgentDir,
    ModelRegistry,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const EXTENSION_ID = "pi-model-filter";
export const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";
const PATCH_MARKER = "__providerModelFilterPatched";
const RUNTIME_KEY = "__providerModelFilterRuntime";
const ORIGINAL_GET_ALL_KEY = "__providerModelFilterOriginalGetAll";
const ORIGINAL_GET_AVAILABLE_KEY = "__providerModelFilterOriginalGetAvailable";
const ORIGINAL_FIND_KEY = "__providerModelFilterOriginalFind";

export type ModelLike = {
    provider: string;
    id: string;
};

export type FilterRuleConfig = {
    provider: string;
    models: string[];
};

export type FilterConfig = {
    include?: FilterRuleConfig[];
    exclude?: FilterRuleConfig[];
};

export type NormalizedRule = {
    providerPattern: string;
    providerRegex: RegExp;
    modelPatterns: string[];
    modelRegexes: RegExp[];
};

export type LoadedConfig = {
    path: string;
    mtimeMs: number;
    includeRules: NormalizedRule[];
    excludeRules: NormalizedRule[];
    error?: string;
};

export type RuntimeState = {
    configCache?: LoadedConfig;
    configCwd?: string;
    projectTrusted?: boolean;
    reportedErrorKey?: string;
    loadConfig: () => LoadedConfig;
};

export type BasicModelRegistry = {
    getAll(): ModelLike[];
    getAvailable(): ModelLike[];
    find(provider: string, modelId: string): ModelLike | undefined;
};

export type PatchedModelRegistry = BasicModelRegistry & {
    [PATCH_MARKER]?: boolean;
    [RUNTIME_KEY]?: RuntimeState;
    [ORIGINAL_GET_ALL_KEY]?: () => ModelLike[];
    [ORIGINAL_GET_AVAILABLE_KEY]?: () => ModelLike[];
    [ORIGINAL_FIND_KEY]?: (provider: string, modelId: string) => ModelLike | undefined;
};

export function globToRegex(pattern: string): RegExp {
    let regex = "";
    for (const character of pattern) {
        if (character === "*") {
            regex += ".*";
        } else if (character === "?") {
            regex += ".";
        } else {
            regex += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
        }
    }
    return new RegExp(`^${regex}$`);
}

const NonBlankString = Type.String({ pattern: "\\S" });

const FilterRuleSchema = Type.Object(
    {
        provider: NonBlankString,
        models: Type.Array(NonBlankString, { minItems: 1 }),
    },
    { additionalProperties: false },
);

const FilterConfigSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        include: Type.Optional(Type.Array(FilterRuleSchema)),
        exclude: Type.Optional(Type.Array(FilterRuleSchema)),
    },
    { additionalProperties: false },
);

type ParsedFilterRuleConfig = Static<typeof FilterRuleSchema>;
type ParsedFilterConfig = Static<typeof FilterConfigSchema>;

const DEFAULT_FILTER_CONFIG: ParsedFilterConfig = {
    $schema: `./${SCHEMA_FILE}`,
    include: [],
    exclude: [],
};

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

function parseSchema<Schema extends TSchema>(
    schema: Schema,
    value: unknown,
    label: string,
): Static<Schema> {
    const errors = [...Value.Errors(schema, value)];
    if (errors.length > 0) {
        const messages = errors
            .slice(0, 5)
            .map((error) => `${formatSchemaPath(error.instancePath)} ${error.message}`);
        let suffix = "";
        if (errors.length > messages.length) {
            suffix = `; and ${errors.length - messages.length} more`;
        }
        throw new Error(`${label} is invalid: ${messages.join("; ")}${suffix}`);
    }
    const parsed: unknown = Value.Parse(schema, value);
    // SAFETY: Value.Errors returned no schema violations, so Value.Parse returns
    // the TypeBox static type represented by the same schema.
    // oxlint-disable-next-line typescript/no-unsafe-return -- SAFETY: TypeBox exposes parsed schema output through a conditional static type that oxlint treats as any here.
    return parsed as Static<Schema>;
}

function normalizeRule(rule: ParsedFilterRuleConfig): FilterRuleConfig {
    return {
        provider: rule.provider.trim(),
        models: rule.models.map((model) => model.trim()),
    };
}

function parseFilterConfig(config: unknown): FilterConfig {
    const parsed = parseSchema(FilterConfigSchema, config, "pi-model-filter config.json");
    return {
        include: (parsed.include ?? []).map(normalizeRule),
        exclude: (parsed.exclude ?? []).map(normalizeRule),
    };
}

export function normalizeRules(rules: FilterRuleConfig[]): NormalizedRule[] {
    return rules.map((rule) => ({
        providerPattern: rule.provider,
        providerRegex: globToRegex(rule.provider),
        modelPatterns: rule.models,
        modelRegexes: rule.models.map((model) => globToRegex(model)),
    }));
}

function findMatchingRule(
    model: ModelLike,
    rules: NormalizedRule[] | undefined,
): NormalizedRule | undefined {
    for (const rule of rules ?? []) {
        if (!rule.providerRegex.test(model.provider)) {
            continue;
        }
        if (rule.modelRegexes.some((regex) => regex.test(model.id))) {
            return rule;
        }
    }
    return undefined;
}

function hasIncludePolicy(model: ModelLike, rules: NormalizedRule[] | undefined): boolean {
    return (rules ?? []).some((rule) => rule.providerRegex.test(model.provider));
}

function isVisibleModel(model: ModelLike, loaded: LoadedConfig): boolean {
    if (hasIncludePolicy(model, loaded.includeRules)) {
        const includeRule = findMatchingRule(model, loaded.includeRules);
        if (includeRule === undefined) {
            return false;
        }
    }

    return findMatchingRule(model, loaded.excludeRules) === undefined;
}

export function filterModels(models: ModelLike[], loaded: LoadedConfig): ModelLike[] {
    return models.filter((model) => isVisibleModel(model, loaded));
}

export function getGlobalConfigPath(): string {
    return join(getAgentDir(), EXTENSION_ID, CONFIG_FILE);
}

export function getProjectConfigPath(cwd: string): string {
    return join(cwd, CONFIG_DIR_NAME, EXTENSION_ID, CONFIG_FILE);
}

function getSchemaPath(configPath: string): string {
    return join(dirname(configPath), SCHEMA_FILE);
}

function writeIfMissing(filePath: string, content: string): void {
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
    } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST") return;
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

function refreshSchemaFile(filePath: string, content: string): void {
    let temporaryPath: string | undefined;
    try {
        mkdirSync(dirname(filePath), { recursive: true });
        try {
            if (readFileSync(filePath, "utf8") === content) return;
        } catch (error: unknown) {
            if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }

        const nextTemporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        writeFileSync(nextTemporaryPath, content, { encoding: "utf8", flag: "wx" });
        temporaryPath = nextTemporaryPath;
        renameSync(temporaryPath, filePath);
        temporaryPath = undefined;
    } catch (error: unknown) {
        if (temporaryPath !== undefined) {
            try {
                unlinkSync(temporaryPath);
            } catch {
                // Ignore cleanup failure while reporting the original scaffold failure.
            }
        }
        if (error instanceof Error) throw error;
        throw new Error(String(error));
    }
}

function readBundledSchema(): string | undefined {
    try {
        return readFileSync(new URL("../config.schema.json", import.meta.url), "utf8");
    } catch {
        return undefined;
    }
}

function scaffoldGlobalConfig(): void {
    const globalConfigPath = getGlobalConfigPath();
    const schema = readBundledSchema();
    if (schema !== undefined) {
        refreshSchemaFile(getSchemaPath(globalConfigPath), schema);
    }
    writeIfMissing(globalConfigPath, `${JSON.stringify(DEFAULT_FILTER_CONFIG, null, 2)}\n`);
}

let scaffoldedGlobalConfigPath: string | undefined;

function ensureGlobalConfigScaffolded(): void {
    const globalConfigPath = getGlobalConfigPath();
    if (scaffoldedGlobalConfigPath === globalConfigPath) return;

    scaffoldGlobalConfig();
    scaffoldedGlobalConfigPath = globalConfigPath;
}

function getConfigPath(state: RuntimeState): string {
    if (state.projectTrusted === true && state.configCwd !== undefined) {
        const projectConfigPath = getProjectConfigPath(state.configCwd);
        if (existsSync(projectConfigPath)) return projectConfigPath;
    }
    return getGlobalConfigPath();
}

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

export function safeReadConfig(state: RuntimeState): LoadedConfig {
    ensureGlobalConfigScaffolded();
    const configPath = getConfigPath(state);
    let mtimeMs = -1;
    try {
        try {
            mtimeMs = statSync(configPath).mtimeMs;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                const loaded: LoadedConfig = {
                    path: configPath,
                    mtimeMs: -1,
                    includeRules: [],
                    excludeRules: [],
                };
                state.configCache = loaded;
                return loaded;
            }
            throw error;
        }
        if (state.configCache?.path === configPath && state.configCache.mtimeMs === mtimeMs) {
            return state.configCache;
        }

        const raw = readFileSync(configPath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        const parsed = parseFilterConfig(parsedJson);
        const loaded: LoadedConfig = {
            path: configPath,
            mtimeMs,
            includeRules: normalizeRules(parsed.include ?? []),
            excludeRules: normalizeRules(parsed.exclude ?? []),
        };
        state.configCache = loaded;
        return loaded;
    } catch (error) {
        let message: string;
        if (error instanceof Error) {
            message = error.message;
        } else {
            message = String(error);
        }
        const loaded: LoadedConfig = {
            path: configPath,
            mtimeMs,
            includeRules: [],
            excludeRules: [],
            error: `Failed to load ${configPath}: ${message}`,
        };
        state.configCache = loaded;
        return loaded;
    }
}

function requireRegistryRuntime(runtime: RuntimeState | undefined): RuntimeState {
    if (runtime !== undefined) return runtime;
    throw new Error("Pi model filter runtime is not initialized.");
}

function reportConfigError(state: RuntimeState, ctx: ExtensionContext, loaded: LoadedConfig): void {
    if (loaded.error === undefined) {
        state.reportedErrorKey = undefined;
        return;
    }

    const errorKey = `${loaded.path}:${loaded.mtimeMs}:${loaded.error}`;
    if (state.reportedErrorKey === errorKey) {
        return;
    }

    state.reportedErrorKey = errorKey;
    ctx.ui.notify(loaded.error, "error");
}

export function installRegistryPatch(registry: PatchedModelRegistry, state: RuntimeState): void {
    registry[RUNTIME_KEY] = state;

    if (
        typeof registry.getAll !== "function" ||
        typeof registry.getAvailable !== "function" ||
        typeof registry.find !== "function"
    ) {
        throw new Error("Pi model registry does not expose the expected methods.");
    }

    if (registry[PATCH_MARKER] === true) {
        return;
    }

    registry[PATCH_MARKER] = true;
    registry[ORIGINAL_GET_ALL_KEY] = Reflect.get(registry, "getAll") as () => ModelLike[];
    registry[ORIGINAL_GET_AVAILABLE_KEY] = Reflect.get(
        registry,
        "getAvailable",
    ) as () => ModelLike[];
    registry[ORIGINAL_FIND_KEY] = Reflect.get(registry, "find") as (
        provider: string,
        modelId: string,
    ) => ModelLike | undefined;

    registry.getAll = function getAll(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_ALL_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        const loaded = runtime.loadConfig();
        return filterModels(models, loaded);
    };

    registry.getAvailable = function getAvailable(this: PatchedModelRegistry) {
        const models = this[ORIGINAL_GET_AVAILABLE_KEY]?.call(this) ?? [];
        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        const loaded = runtime.loadConfig();
        return filterModels(models, loaded);
    };

    registry.find = function find(this: PatchedModelRegistry, provider: string, modelId: string) {
        const finder = this[ORIGINAL_FIND_KEY] ?? registry[ORIGINAL_FIND_KEY];
        const model = finder?.call(this, provider, modelId);
        if (model === undefined) {
            return undefined;
        }

        const runtime = requireRegistryRuntime(this[RUNTIME_KEY] ?? registry[RUNTIME_KEY]);
        const loaded = runtime.loadConfig();
        if (!isVisibleModel(model, loaded)) {
            return undefined;
        }
        return model;
    };
}

export default function providerModelFilterExtension(pi: ExtensionAPI) {
    const state: RuntimeState = {
        loadConfig: () => safeReadConfig(state),
    };

    installRegistryPatch(ModelRegistry.prototype as PatchedModelRegistry, state);

    pi.on("session_start", async (_event, ctx) => {
        setConfigContext(state, ctx);
        installRegistryPatch(ctx.modelRegistry as PatchedModelRegistry, state);
        reportConfigError(state, ctx, state.loadConfig());
    });

    pi.on("turn_start", (_event, ctx) => {
        setConfigContext(state, ctx);
        reportConfigError(state, ctx, state.loadConfig());
    });
}
