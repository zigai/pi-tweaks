import { type ResolvedSettings } from "@zigai/pi-extension-settings";

import {
    getPiGlobalSettingsPath,
    loadPiExtensionSettings,
    type BundledSchemaSource,
    type SettingsDiagnostic,
} from "@zigai/pi-extension-settings/pi";

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
import { fileURLToPath } from "node:url";

import { Type, type Static } from "typebox";

import { Value } from "typebox/value";

import { definePrevalidatedExtensionSettings } from "@zigai/pi-extension-settings/runtime";
import {
    SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY,
    USE_THINKING_BORDER_COLORS_SETTINGS_KEY,
    defaultModelSchema,
    extensionSettingsInput,
    modeShortcutsSchema,
    modeSpecSchema,
} from "./settings-input.ts";
import prevalidatedSettings from "./settings.prevalidated.ts";

export * from "./settings-input.ts";

export const modelModesSettingsDefinition = definePrevalidatedExtensionSettings(
    extensionSettingsInput,
    prevalidatedSettings,
);

export default modelModesSettingsDefinition;

const SETTINGS_LOCK_TIMEOUT_MS = 5_000;
const STALE_SETTINGS_LOCK_MS = 30_000;
const EXTENSION_ID = "pi-model-modes";
const BUNDLED_SETTINGS_SCHEMA_URL = new URL("../config.schema.json", import.meta.url);
export type ModeShortcuts = Static<typeof modeShortcutsSchema>;

const SettingsObjectSchema = Type.Object(
    {
        $schema: Type.Optional(Type.String()),
        version: Type.Optional(Type.Number()),
        currentMode: Type.Optional(Type.String()),
        defaultModel: Type.Optional(defaultModelSchema),
        [USE_THINKING_BORDER_COLORS_SETTINGS_KEY]: Type.Optional(Type.Boolean()),
        [SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY]: Type.Optional(Type.Boolean()),
        shortcuts: Type.Optional(modeShortcutsSchema),
        modes: Type.Optional(Type.Record(Type.String(), modeSpecSchema)),
    },
    { additionalProperties: false },
);
type SettingsObject = Static<typeof SettingsObjectSchema>;
type ModelModesSettings = ResolvedSettings<typeof modelModesSettingsDefinition>;
type ModeDisplaySettings = {
    readonly useThinkingBorderColors: ModelModesSettings[typeof USE_THINKING_BORDER_COLORS_SETTINGS_KEY];
    readonly showThinkingLevelStatus: ModelModesSettings[typeof SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY];
};

type NodeErrorWithCode = Error & {
    readonly code: string;
};
export type SettingsReadContext = {
    readonly cwd: string;
    readonly projectTrusted: boolean;
};

function getSettingsPath(): string {
    return getPiGlobalSettingsPath(EXTENSION_ID);
}

export function createStableBundledSchemaSource(url: URL): () => BundledSchemaSource {
    let content: string | undefined;
    return () => {
        if (content !== undefined) return { kind: "content", content };

        try {
            content = readFileSync(url, "utf8");
            return { kind: "content", content };
        } catch {
            return { kind: "url", url };
        }
    };
}

// Pi can retain imported definition modules while rebinding extensions for /new. Cache the schema
// read by that same module instance so a concurrently updated source checkout cannot mix versions.
const bundledSettingsSchemaSource = createStableBundledSchemaSource(BUNDLED_SETTINGS_SCHEMA_URL);

export function formatModelModesSettingsDiagnostic(diagnostic: SettingsDiagnostic): string {
    const prefix = `[${EXTENSION_ID}]`;
    if (diagnostic.code === "bundled-schema-stale") {
        return `${prefix} Generated settings schema does not match the loaded definition: ${fileURLToPath(BUNDLED_SETTINGS_SCHEMA_URL)}. In a source checkout, run "npm run config:generate" from the repository root and restart Pi; otherwise reinstall or update the extension.`;
    }
    if (diagnostic.code === "bundled-schema-read-failed") {
        return `${prefix} Bundled settings schema could not be read: ${fileURLToPath(BUNDLED_SETTINGS_SCHEMA_URL)}.`;
    }
    return `${prefix} ${diagnostic.message}: ${diagnostic.path}`;
}

export function loadModelModesSettings(context: SettingsReadContext) {
    return loadPiExtensionSettings(
        modelModesSettingsDefinition,
        {
            cwd: context.cwd,
            isProjectTrusted: () => context.projectTrusted,
        },
        { bundledSchema: bundledSettingsSchemaSource() },
    );
}

export type LoadedModelModesSettings = ReturnType<typeof loadModelModesSettings>;

function isNodeErrorWithCode(cause: unknown): cause is NodeErrorWithCode {
    return cause instanceof Error && "code" in cause && typeof cause.code === "string";
}

function getErrorCode(cause: unknown): string | undefined {
    if (isNodeErrorWithCode(cause)) return cause.code;
    return undefined;
}

function throwError(cause: unknown): never {
    if (cause instanceof Error) throw cause;
    throw new Error(String(cause));
}

function sleepSync(ms: number): void {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, ms);
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

const settingsObjectDecoder = {
    parse(value: unknown, settingsPath: string): SettingsObject {
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
        return Value.Parse(SettingsObjectSchema, value);
    },
};

function readSettingsObject(
    settingsPath: string,
    options?: { throwOnInvalid?: boolean },
): SettingsObject {
    try {
        const raw = readFileSync(settingsPath, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        return settingsObjectDecoder.parse(parsedJson, settingsPath);
    } catch (error: unknown) {
        if (getErrorCode(error) === "ENOENT") return {};
        if (options?.throwOnInvalid === true) throwError(error);
        // Ignore malformed config files while reading and fall back to defaults.
    }

    return {};
}

function updateSettingsObject(
    context: SettingsReadContext,
    update: (settings: SettingsObject) => void,
): void {
    loadModelModesSettings(context);
    const settingsPath = getSettingsPath();
    withSettingsLock(settingsPath, () => {
        const settings = readSettingsObject(settingsPath, { throwOnInvalid: true });
        update(settings);
        atomicWriteUtf8Sync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    });
}

export function resolveModeShortcuts(value: ModeShortcuts | undefined): ModeShortcuts {
    if (!Value.Check(modeShortcutsSchema, value)) return {};
    return Value.Parse(modeShortcutsSchema, value);
}

export function getConfiguredModeShortcuts(context: SettingsReadContext): ModeShortcuts {
    const value = loadModelModesSettings(context).globalSettingsLayer?.shortcuts;
    if (!Value.Check(modeShortcutsSchema, value)) return {};
    return resolveModeShortcuts(Value.Parse(modeShortcutsSchema, value));
}

function readModeSettings(context: SettingsReadContext): ModeDisplaySettings {
    const settings = loadModelModesSettings(context).settings;
    return {
        useThinkingBorderColors: settings[USE_THINKING_BORDER_COLORS_SETTINGS_KEY],
        showThinkingLevelStatus: settings[SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY],
    };
}

export function shouldUseThinkingBorderColors(context: SettingsReadContext): boolean {
    return readModeSettings(context).useThinkingBorderColors;
}

export function shouldShowThinkingLevelStatus(context: SettingsReadContext): boolean {
    return readModeSettings(context).showThinkingLevelStatus;
}

export function setUseThinkingBorderColors(
    context: SettingsReadContext,
    useThinkingBorderColors: boolean,
): void {
    updateSettingsObject(context, (settings) => {
        settings[USE_THINKING_BORDER_COLORS_SETTINGS_KEY] = useThinkingBorderColors;
    });
}

export function setShowThinkingLevelStatus(
    context: SettingsReadContext,
    showThinkingLevelStatus: boolean,
): void {
    updateSettingsObject(context, (settings) => {
        settings[SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY] = showThinkingLevelStatus;
    });
}
