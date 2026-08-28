import { getPiGlobalSettingsPath, loadPiExtensionSettings } from "@zigai/pi-extension-settings/pi";

import {
    SettingsManager,
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

import { Value } from "typebox/value";

import { definePrevalidatedExtensionSettings } from "@zigai/pi-extension-settings/runtime";
import {
    MAX_VISIBLE_LINES_SETTINGS_KEY,
    MIN_VISIBLE_LINES,
    PREVIEW_FULL_HEIGHT_SETTINGS_KEY,
    PREVIEW_SETTINGS_KEY,
    PiThemeSettings,
    PiThemeSettingsSchema,
    SETTINGS_KEY,
    SETTINGS_LOCK_TIMEOUT_MS,
    STALE_SETTINGS_LOCK_MS,
    SettingsObject,
    SettingsObjectSchema,
    TreeTimestampModeSchema,
    extensionSettingsInput,
} from "./settings-input.ts";
import prevalidatedSettings from "./settings.prevalidated.ts";
import { DEFAULT_MODE, type TreeTimestampMode } from "./timestamps.ts";

export * from "./settings-input.ts";

export const treeSettingsDefinition = definePrevalidatedExtensionSettings(
    extensionSettingsInput,
    prevalidatedSettings,
);

export default treeSettingsDefinition;

const EXTENSION_ID = "pi-tree";

type SettingsReadContext = {
    cwd: string;
    projectTrusted: boolean;
};

let settingsReadContext: SettingsReadContext | undefined;
let cachedMode: TreeTimestampMode | null = null;
let cachedPreviewEnabled: boolean | null = null;
let cachedMaxVisibleLines: number | null | undefined;
let cachedPreviewFullHeight: boolean | undefined;
let cachedThemeName: string | undefined;
let cachedThemeNameLoaded = false;

export type TreeSettingsContext = Pick<ExtensionContext, "cwd" | "isProjectTrusted">;

function isProjectTrusted(ctx: TreeSettingsContext): boolean {
    return ctx.isProjectTrusted();
}

function clearReadCaches(): void {
    cachedMode = null;
    cachedPreviewEnabled = null;
    cachedMaxVisibleLines = undefined;
    cachedPreviewFullHeight = undefined;
    cachedThemeName = undefined;
    cachedThemeNameLoaded = false;
}

export function setSettingsContext(ctx: TreeSettingsContext): void {
    const next: SettingsReadContext = {
        cwd: ctx.cwd,
        projectTrusted: isProjectTrusted(ctx),
    };
    if (
        settingsReadContext?.cwd !== next.cwd ||
        settingsReadContext.projectTrusted !== next.projectTrusted
    ) {
        settingsReadContext = next;
        clearReadCaches();
    }
}

export function isTreeTimestampMode(value: unknown): value is TreeTimestampMode {
    return Value.Check(TreeTimestampModeSchema, value);
}

function getSettingsPath(): string {
    return getPiGlobalSettingsPath(EXTENSION_ID);
}

export function loadTreeSettings() {
    const context = settingsReadContext ?? { cwd: process.cwd(), projectTrusted: false };
    return loadPiExtensionSettings(
        treeSettingsDefinition,
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

function isErrnoException(cause: unknown): cause is NodeJS.ErrnoException {
    if (!(cause instanceof Error)) return false;
    return typeof Object.getOwnPropertyDescriptor(cause, "code")?.value === "string";
}

function throwCause(cause: unknown): never {
    if (cause instanceof Error) throw cause;
    throw new Error(String(cause));
}

function sleepSync(ms: number): void {
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function formatSchemaPath(instancePath: string): string {
    if (instancePath.length === 0) return "root";
    return instancePath
        .slice(1)
        .split("/")
        .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
        .join(".");
}

const settingsObjectParser = {
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
        return settingsObjectParser.parse(parsedJson, settingsPath);
    } catch (cause: unknown) {
        if (isErrnoException(cause) && cause.code === "ENOENT") return {};
        if (options?.throwOnInvalid === true) throwCause(cause);
    }

    return {};
}

function readMergedSettingsObject(): SettingsObject {
    const settings = loadTreeSettings().settings;
    return {
        [SETTINGS_KEY]: settings[SETTINGS_KEY],
        [PREVIEW_SETTINGS_KEY]: settings[PREVIEW_SETTINGS_KEY],
        [MAX_VISIBLE_LINES_SETTINGS_KEY]: settings[MAX_VISIBLE_LINES_SETTINGS_KEY],
        [PREVIEW_FULL_HEIGHT_SETTINGS_KEY]: settings[PREVIEW_FULL_HEIGHT_SETTINGS_KEY],
    };
}

function readMergedPiSettingsObject(): PiThemeSettings {
    const context = settingsReadContext ?? { cwd: process.cwd(), projectTrusted: false };
    const manager = SettingsManager.create(context.cwd, getAgentDir(), {
        projectTrusted: context.projectTrusted,
    });
    return Value.Parse(PiThemeSettingsSchema, {
        ...manager.getGlobalSettings(),
        ...manager.getProjectSettings(),
    });
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
        } catch (cause: unknown) {
            if (!isErrnoException(cause) || cause.code !== "EEXIST") throwCause(cause);

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
    } catch (cause: unknown) {
        if (isErrnoException(cause) && (cause.code === "EEXIST" || cause.code === "EPERM")) {
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
        throwCause(cause);
    }
}

function updateSettingsObject(update: (settings: SettingsObject) => void): void {
    loadTreeSettings();
    const settingsPath = getSettingsPath();
    withSettingsLock(settingsPath, () => {
        const settings = readSettingsObject(settingsPath, { throwOnInvalid: true });
        update(settings);
        atomicWriteUtf8Sync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    });
}

export function getPersistedMode(): TreeTimestampMode {
    if (cachedMode !== null) return cachedMode;

    const settings = readMergedSettingsObject();
    cachedMode = settings[SETTINGS_KEY] ?? DEFAULT_MODE;
    return cachedMode;
}

export function getPersistedPreviewEnabled(): boolean {
    if (cachedPreviewEnabled !== null) return cachedPreviewEnabled;

    const settings = readMergedSettingsObject();
    cachedPreviewEnabled = settings[PREVIEW_SETTINGS_KEY] ?? false;
    return cachedPreviewEnabled;
}

export function getPersistedMaxVisibleLines(): number | null {
    if (cachedMaxVisibleLines !== undefined) return cachedMaxVisibleLines;

    const settings = readMergedSettingsObject();
    const configured = settings[MAX_VISIBLE_LINES_SETTINGS_KEY];
    cachedMaxVisibleLines = null;
    if (configured !== undefined && Number.isFinite(configured)) {
        cachedMaxVisibleLines = Math.max(MIN_VISIBLE_LINES, Math.floor(configured));
    }
    return cachedMaxVisibleLines;
}

export function getPersistedPreviewFullHeight(): boolean {
    if (cachedPreviewFullHeight !== undefined) return cachedPreviewFullHeight;

    const settings = readMergedSettingsObject();
    cachedPreviewFullHeight = settings[PREVIEW_FULL_HEIGHT_SETTINGS_KEY] ?? true;
    return cachedPreviewFullHeight;
}

export function getConfiguredThemeName(): string | undefined {
    if (cachedThemeNameLoaded) return cachedThemeName;

    const settings = readMergedPiSettingsObject();
    cachedThemeName = settings.theme;
    cachedThemeNameLoaded = true;
    return cachedThemeName;
}

function warnSettingsWriteFailed(cause: unknown): void {
    let suffix = "";
    if (cause instanceof Error && cause.message.length > 0) {
        suffix = `: ${cause.message}`;
    }
    console.warn(`[pi-tree] settings update was not saved${suffix}`);
}

export function persistPreviewEnabled(enabled: boolean): void {
    try {
        updateSettingsObject((settings) => {
            settings[PREVIEW_SETTINGS_KEY] = enabled;
        });
        cachedPreviewEnabled = enabled;
    } catch (cause: unknown) {
        warnSettingsWriteFailed(cause);
    }
}

export function persistMode(mode: TreeTimestampMode): void {
    try {
        updateSettingsObject((settings) => {
            settings[SETTINGS_KEY] = mode;
        });
        cachedMode = mode;
    } catch (cause: unknown) {
        warnSettingsWriteFailed(cause);
    }
}
