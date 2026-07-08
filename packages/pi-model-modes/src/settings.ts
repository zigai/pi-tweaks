import {
    CONFIG_DIR_NAME,
    getAgentDir,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
    closeSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const SHOW_MODE_NAME_SETTINGS_KEY = "modeShowName";
export const USE_THINKING_BORDER_COLORS_SETTINGS_KEY = "modeUseThinkingBorderColors";
export const SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY = "modeShowThinkingLevelStatus";

const SETTINGS_LOCK_TIMEOUT_MS = 5_000;
const STALE_SETTINGS_LOCK_MS = 30_000;
const EXTENSION_ID = "pi-model-modes";
const LEGACY_EXTENSION_ID = "pi-mode";
const CONFIG_FILE = "config.json";
const SCHEMA_FILE = "config.schema.json";
const ModeSpecJsonSchema = Type.Object(
    {
        provider: Type.Optional(Type.String()),
        modelId: Type.Optional(Type.String()),
        thinkingLevel: Type.Optional(Type.Unknown()),
        color: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);

const SettingsObjectSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        version: Type.Optional(Type.Number()),
        currentMode: Type.Optional(Type.String()),
        [SHOW_MODE_NAME_SETTINGS_KEY]: Type.Optional(Type.Boolean()),
        [USE_THINKING_BORDER_COLORS_SETTINGS_KEY]: Type.Optional(Type.Boolean()),
        [SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY]: Type.Optional(Type.Boolean()),
        modes: Type.Optional(Type.Record(Type.String(), ModeSpecJsonSchema)),
    },
    { additionalProperties: false },
);
const BooleanSettingSchema = Type.Boolean();

type SettingsReadContext = {
    cwd: string;
    projectTrusted: boolean;
};

const DEFAULT_MODE_CONFIG_FILE = {
    $schema: `./${SCHEMA_FILE}`,
    version: 1,
    currentMode: "default",
    [SHOW_MODE_NAME_SETTINGS_KEY]: false,
    [USE_THINKING_BORDER_COLORS_SETTINGS_KEY]: false,
    [SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY]: false,
    modes: {},
};

let settingsReadContext: SettingsReadContext | undefined;
let cachedSettings:
    | {
          showModeName: boolean;
          useThinkingBorderColors: boolean;
          showThinkingLevelStatus: boolean;
      }
    | undefined;

type ProjectTrustContext = ExtensionContext & {
    isProjectTrusted?: () => boolean;
};

function isProjectTrusted(ctx: ExtensionContext): boolean {
    return (ctx as ProjectTrustContext).isProjectTrusted?.() ?? true;
}

export function setSettingsContext(ctx: ExtensionContext): void {
    const next: SettingsReadContext = {
        cwd: ctx.cwd,
        projectTrusted: isProjectTrusted(ctx),
    };
    if (
        settingsReadContext?.cwd !== next.cwd ||
        settingsReadContext.projectTrusted !== next.projectTrusted
    ) {
        settingsReadContext = next;
        cachedSettings = undefined;
    }
}

function getSettingsPathForExtension(extensionId: string): string {
    return join(getAgentDir(), extensionId, CONFIG_FILE);
}

function getProjectSettingsPathForExtension(cwd: string, extensionId: string): string {
    return join(cwd, CONFIG_DIR_NAME, extensionId, CONFIG_FILE);
}

function getSettingsPath(): string {
    return getSettingsPathForExtension(EXTENSION_ID);
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

function fileExistsSync(filePath: string): boolean {
    try {
        statSync(filePath);
        return true;
    } catch {
        return false;
    }
}

function copyLegacyGlobalConfigIfMissing(configPath: string): void {
    if (fileExistsSync(configPath)) return;

    try {
        const legacyConfig = readFileSync(getSettingsPathForExtension(LEGACY_EXTENSION_ID), "utf8");
        writeIfMissing(configPath, legacyConfig);
    } catch {}
}

function scaffoldGlobalConfig(): void {
    const globalConfigPath = getSettingsPath();
    const schema = readBundledSchema();
    if (schema !== undefined) {
        refreshSchemaFile(getSchemaPath(globalConfigPath), schema);
    }
    copyLegacyGlobalConfigIfMissing(globalConfigPath);
    writeIfMissing(globalConfigPath, `${JSON.stringify(DEFAULT_MODE_CONFIG_FILE, null, 2)}\n`);
}

function getProjectSettingsPath(): string | undefined {
    if (settingsReadContext === undefined || !settingsReadContext.projectTrusted) {
        return undefined;
    }

    const projectPath = getProjectSettingsPathForExtension(settingsReadContext.cwd, EXTENSION_ID);
    if (fileExistsSync(projectPath)) return projectPath;

    const legacyProjectPath = getProjectSettingsPathForExtension(
        settingsReadContext.cwd,
        LEGACY_EXTENSION_ID,
    );
    if (fileExistsSync(legacyProjectPath)) return legacyProjectPath;

    return projectPath;
}

function getErrorCode(error: unknown): string | undefined {
    if (!(error instanceof Error)) return undefined;
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string") return code;
    return undefined;
}

function throwError(error: unknown): never {
    if (error instanceof Error) throw error;
    throw new Error(String(error));
}

function sleepSync(ms: number): void {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function parseOptionalBoolean(schema: TSchema, value: unknown): boolean | undefined {
    if (value === undefined) return undefined;
    if (!Value.Check(schema, value)) return undefined;
    const parsed: unknown = Value.Parse(schema, value);
    if (typeof parsed === "boolean") return parsed;
    return undefined;
}

function withSettingsLock<T>(settingsPath: string, fn: () => T): T {
    const lockPath = `${settingsPath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true });

    const start = Date.now();
    while (true) {
        try {
            const fd = openSync(lockPath, "wx");
            try {
                writeFileSync(
                    fd,
                    `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
                    "utf8",
                );
            } catch {
                // Ignore best-effort lock metadata.
            }

            try {
                return fn();
            } finally {
                try {
                    closeSync(fd);
                } catch {
                    // Ignore cleanup failures.
                }
                try {
                    unlinkSync(lockPath);
                } catch {
                    // Ignore cleanup failures.
                }
            }
        } catch (error: unknown) {
            if (getErrorCode(error) !== "EEXIST") throwError(error);

            try {
                const stat = statSync(lockPath);
                if (Date.now() - stat.mtimeMs > STALE_SETTINGS_LOCK_MS) {
                    unlinkSync(lockPath);
                    continue;
                }
            } catch {
                // Ignore stale-lock checks.
            }

            if (Date.now() - start > SETTINGS_LOCK_TIMEOUT_MS) {
                throw new Error(`Timed out waiting for lock: ${lockPath}`);
            }
            sleepSync(40 + Math.random() * 80);
        }
    }
}

function atomicWriteUtf8Sync(filePath: string, content: string): void {
    mkdirSync(dirname(filePath), { recursive: true });

    const tempPath = join(
        dirname(filePath),
        `.${filePath.split(/[\\/]/).pop() ?? "settings.json"}.tmp.${process.pid}.${Math.random()
            .toString(16)
            .slice(2)}`,
    );

    writeFileSync(tempPath, content, "utf8");

    try {
        renameSync(tempPath, filePath);
    } catch (error: unknown) {
        const code = getErrorCode(error);
        if (code === "EEXIST" || code === "EPERM") {
            try {
                unlinkSync(filePath);
            } catch {
                // Ignore missing target before retrying the rename.
            }
            renameSync(tempPath, filePath);
            return;
        }
        try {
            unlinkSync(tempPath);
        } catch {
            // Ignore cleanup failures.
        }
        throwError(error);
    }
}

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

function parseSettingsObject(value: unknown, settingsPath: string): Record<string, unknown> {
    const errors = [...Value.Errors(SettingsObjectSchema, value)];
    if (errors.length > 0) {
        const messages = errors
            .slice(0, 5)
            .map((error) => `${formatSchemaPath(error.instancePath)} ${error.message}`);
        let suffix = "";
        if (errors.length > messages.length) {
            suffix = `; and ${errors.length - messages.length} more`;
        }
        throw new Error(
            `${settingsPath} must contain a JSON object: ${messages.join("; ")}${suffix}`,
        );
    }
    return Object.fromEntries(Object.entries(Value.Parse(SettingsObjectSchema, value)));
}

function readSettingsObject(
    settingsPath: string,
    options?: { throwOnInvalid?: boolean },
): Record<string, unknown> {
    if (settingsPath === getSettingsPath()) {
        scaffoldGlobalConfig();
    }

    try {
        const raw = readFileSync(settingsPath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        return parseSettingsObject(parsedJson, settingsPath);
    } catch (error: unknown) {
        if (getErrorCode(error) === "ENOENT") return {};
        if (options?.throwOnInvalid === true) throwError(error);
        // Ignore malformed config files while reading and fall back to defaults.
    }

    return {};
}

function updateSettingsObject(update: (settings: Record<string, unknown>) => void): void {
    scaffoldGlobalConfig();
    const settingsPath = getSettingsPath();
    withSettingsLock(settingsPath, () => {
        const settings = readSettingsObject(settingsPath, { throwOnInvalid: true });
        update(settings);
        atomicWriteUtf8Sync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    });
}

function applyBooleanSetting(
    settings: Record<string, unknown>,
    key: string,
    fallback: boolean,
): boolean {
    const parsed = parseOptionalBoolean(BooleanSettingSchema, settings[key]);
    if (parsed === undefined) return fallback;
    return parsed;
}

function readModeSettings(): {
    showModeName: boolean;
    useThinkingBorderColors: boolean;
    showThinkingLevelStatus: boolean;
} {
    if (cachedSettings !== undefined) {
        return cachedSettings;
    }

    let showModeName = false;
    let useThinkingBorderColors = false;
    let showThinkingLevelStatus = false;

    const globalSettings = readSettingsObject(getSettingsPath());
    showModeName = applyBooleanSetting(globalSettings, SHOW_MODE_NAME_SETTINGS_KEY, showModeName);
    useThinkingBorderColors = applyBooleanSetting(
        globalSettings,
        USE_THINKING_BORDER_COLORS_SETTINGS_KEY,
        useThinkingBorderColors,
    );
    showThinkingLevelStatus = applyBooleanSetting(
        globalSettings,
        SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY,
        showThinkingLevelStatus,
    );

    const projectSettingsPath = getProjectSettingsPath();
    if (projectSettingsPath !== undefined) {
        const projectSettings = readSettingsObject(projectSettingsPath);
        showModeName = applyBooleanSetting(
            projectSettings,
            SHOW_MODE_NAME_SETTINGS_KEY,
            showModeName,
        );
        useThinkingBorderColors = applyBooleanSetting(
            projectSettings,
            USE_THINKING_BORDER_COLORS_SETTINGS_KEY,
            useThinkingBorderColors,
        );
        showThinkingLevelStatus = applyBooleanSetting(
            projectSettings,
            SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY,
            showThinkingLevelStatus,
        );
    }

    cachedSettings = {
        showModeName,
        useThinkingBorderColors,
        showThinkingLevelStatus,
    };
    return cachedSettings;
}

export function shouldShowModeName(): boolean {
    return readModeSettings().showModeName;
}

export function shouldUseThinkingBorderColors(): boolean {
    return readModeSettings().useThinkingBorderColors;
}

export function shouldShowThinkingLevelStatus(): boolean {
    return readModeSettings().showThinkingLevelStatus;
}

export function setShowModeName(show: boolean): void {
    updateSettingsObject((settings) => {
        settings[SHOW_MODE_NAME_SETTINGS_KEY] = show;
    });

    cachedSettings = undefined;
}

export function setUseThinkingBorderColors(useThinkingBorderColors: boolean): void {
    updateSettingsObject((settings) => {
        settings[USE_THINKING_BORDER_COLORS_SETTINGS_KEY] = useThinkingBorderColors;
    });

    cachedSettings = undefined;
}

export function setShowThinkingLevelStatus(showThinkingLevelStatus: boolean): void {
    updateSettingsObject((settings) => {
        settings[SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY] = showThinkingLevelStatus;
    });

    cachedSettings = undefined;
}
