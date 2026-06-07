import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SHOW_MODE_NAME_SETTINGS_KEY = "modeShowName";

let cachedShowModeName: boolean | undefined;
let cachedSettingsMtimeMs: number | null | undefined;

function getSettingsPath(): string {
    return join(homedir(), ".pi", "agent", "settings.json");
}

function getSettingsMtimeMs(): number | null {
    try {
        if (!existsSync(getSettingsPath())) return null;
        return statSync(getSettingsPath()).mtimeMs;
    } catch {
        return null;
    }
}

function readSettingsObject(): Record<string, unknown> {
    try {
        const raw = readFileSync(getSettingsPath(), "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return { ...parsed };
        }
    } catch {
        // Ignore malformed or missing settings files and fall back to defaults.
    }

    return {};
}

export function shouldShowModeName(): boolean {
    const mtimeMs = getSettingsMtimeMs();
    if (cachedShowModeName !== undefined && cachedSettingsMtimeMs === mtimeMs) {
        return cachedShowModeName;
    }

    const settings = readSettingsObject();
    cachedSettingsMtimeMs = mtimeMs;
    cachedShowModeName = settings[SHOW_MODE_NAME_SETTINGS_KEY] === true;
    return cachedShowModeName;
}

export function setShowModeName(show: boolean): void {
    const settingsPath = getSettingsPath();
    const settings = readSettingsObject();
    settings[SHOW_MODE_NAME_SETTINGS_KEY] = show;

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

    cachedSettingsMtimeMs = getSettingsMtimeMs();
    cachedShowModeName = show;
}
