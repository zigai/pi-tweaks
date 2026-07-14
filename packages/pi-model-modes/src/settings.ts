import { defineExtensionSettings } from "@zigai/pi-extension-settings";
import { getPiGlobalSettingsPath, loadPiExtensionSettings } from "@zigai/pi-extension-settings/pi";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const USE_THINKING_BORDER_COLORS_SETTINGS_KEY = "modeUseThinkingBorderColors";
export const SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY = "modeShowThinkingLevelStatus";

export const modeSpecSchema = Type.Object(
    {
        provider: Type.Optional(Type.String()),
        modelId: Type.Optional(Type.String()),
        thinkingLevel: Type.Optional(Type.Unknown()),
        color: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
);

export const defaultModelSchema = Type.Object(
    {
        provider: Type.String({
            minLength: 1,
            description: "Default model provider.",
        }),
        modelId: Type.String({ minLength: 1, description: "Default model ID." }),
        thinkingLevel: Type.Optional(
            Type.Unknown({ description: "Optional default thinking level." }),
        ),
    },
    { additionalProperties: false },
);

export const modeShortcutsSchema = Type.Object(
    {
        forward: Type.Optional(
            Type.String({ minLength: 1, description: "Shortcut for cycling modes forward." }),
        ),
        backward: Type.Optional(
            Type.String({ minLength: 1, description: "Shortcut for cycling modes backward." }),
        ),
    },
    { additionalProperties: false },
);

export const modelModesSettingsDefinition = defineExtensionSettings({
    id: "pi-model-modes",
    title: "Pi Model Modes",
    description: "Settings and mode definitions for switching model configurations.",
    schemaId:
        "https://raw.githubusercontent.com/zigai/pi-tweaks/master/packages/pi-model-modes/config.schema.json",
    schema: Type.Object(
        {
            version: Type.Number({ default: 1, description: "Settings format version." }),
            currentMode: Type.String({
                default: "default",
                description: "Currently selected mode ID.",
            }),
            defaultModel: Type.Optional(defaultModelSchema),
            [USE_THINKING_BORDER_COLORS_SETTINGS_KEY]: Type.Boolean({
                default: false,
                description: "Use thinking-level colors instead of mode colors for borders.",
            }),
            [SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY]: Type.Boolean({
                default: false,
                description: "Show thinking level alongside mode status.",
            }),
            shortcuts: Type.Optional(modeShortcutsSchema),
            modes: Type.Record(Type.String(), modeSpecSchema, {
                default: {},
                description: "Named model-mode specifications keyed by mode ID.",
            }),
        },
        { additionalProperties: false },
    ),
});

export default modelModesSettingsDefinition;

const SETTINGS_LOCK_TIMEOUT_MS = 5_000;
const STALE_SETTINGS_LOCK_MS = 30_000;
const EXTENSION_ID = "pi-model-modes";
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
type SettingsReadContext = {
    cwd: string;
    projectTrusted: boolean;
};

let settingsReadContext: SettingsReadContext | undefined;
let cachedSettings:
    | {
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

function getSettingsPath(): string {
    return getPiGlobalSettingsPath(EXTENSION_ID);
}

export function loadModelModesSettings() {
    const context = settingsReadContext ?? { cwd: process.cwd(), projectTrusted: false };
    return loadPiExtensionSettings(
        modelModesSettingsDefinition,
        {
            cwd: context.cwd,
            isProjectTrusted: () => context.projectTrusted,
        },
        {
            bundledSchema: {
                kind: "url",
                url: new URL("../config.schema.json", import.meta.url),
            },
        },
    );
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
    loadModelModesSettings();
    const settingsPath = getSettingsPath();
    withSettingsLock(settingsPath, () => {
        const settings = readSettingsObject(settingsPath, { throwOnInvalid: true });
        update(settings);
        atomicWriteUtf8Sync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    });
}

function parseModeShortcuts(value: unknown): ModeShortcuts {
    if (!Value.Check(modeShortcutsSchema, value)) return {};
    const parsed: unknown = Value.Parse(modeShortcutsSchema, value);
    // SAFETY: Value.Check succeeded against the same schema, so this parse result has the schema's static type.
    return parsed as ModeShortcuts;
}

export function getConfiguredModeShortcuts(): ModeShortcuts {
    return parseModeShortcuts(loadModelModesSettings().globalSettingsLayer?.shortcuts);
}

function readModeSettings(): {
    useThinkingBorderColors: boolean;
    showThinkingLevelStatus: boolean;
} {
    if (cachedSettings !== undefined) return cachedSettings;

    const settings = loadModelModesSettings().settings;
    cachedSettings = {
        useThinkingBorderColors: settings[USE_THINKING_BORDER_COLORS_SETTINGS_KEY],
        showThinkingLevelStatus: settings[SHOW_THINKING_LEVEL_STATUS_SETTINGS_KEY],
    };
    return cachedSettings;
}

export function shouldUseThinkingBorderColors(): boolean {
    return readModeSettings().useThinkingBorderColors;
}

export function shouldShowThinkingLevelStatus(): boolean {
    return readModeSettings().showThinkingLevelStatus;
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
