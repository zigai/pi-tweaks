import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shouldShowThinkingLevelStatus } from "./settings.ts";

const STATUS_PATCH_MARKER = Symbol.for("zigai.pi-mode.thinking-status-patch");
const THINKING_LEVEL_STATUS_PREFIX = "Thinking level: ";

type InteractiveModePrototype = {
    showStatus(message: string): void;
    [STATUS_PATCH_MARKER]?: true;
};

type InteractiveModeClass = {
    prototype: InteractiveModePrototype;
};

type InteractiveModeModule = {
    InteractiveMode?: InteractiveModeClass;
};

type ShowStatus = (this: InteractiveModePrototype, message: string) => void;

function isShowStatus(value: unknown): value is ShowStatus {
    return typeof value === "function";
}

function warnStatusPatchUnavailable(error?: unknown): void {
    let suffix = "";
    if (error instanceof Error && error.message.length > 0) {
        suffix = `: ${error.message}`;
    }
    console.warn(
        `[pi-mode] thinking-level status patch unavailable; Pi internals may have changed${suffix}`,
    );
}

async function loadInteractiveModeModule(): Promise<InteractiveModeModule | undefined> {
    try {
        const codingAgentEntry = fileURLToPath(
            import.meta.resolve("@earendil-works/pi-coding-agent"),
        );
        const distDir = dirname(codingAgentEntry);
        const interactiveModePath = pathToFileURL(
            join(distDir, "modes/interactive/interactive-mode.js"),
        ).href;
        return (await import(interactiveModePath)) as InteractiveModeModule;
    } catch (error: unknown) {
        warnStatusPatchUnavailable(error);
        return undefined;
    }
}

export async function applyThinkingLevelStatusPatch(): Promise<void> {
    const module = await loadInteractiveModeModule();
    const prototype = module?.InteractiveMode?.prototype;
    if (prototype === undefined) return;
    if (prototype[STATUS_PATCH_MARKER] === true) return;
    if (typeof prototype.showStatus !== "function") {
        warnStatusPatchUnavailable(new Error("InteractiveMode.showStatus is not a function"));
        return;
    }

    const showStatusDescriptor = Object.getOwnPropertyDescriptor(prototype, "showStatus");
    const showStatus: unknown = showStatusDescriptor?.value;
    if (!isShowStatus(showStatus)) {
        warnStatusPatchUnavailable(new Error("InteractiveMode.showStatus descriptor is invalid"));
        return;
    }

    prototype.showStatus = function patchedShowStatus(
        this: InteractiveModePrototype,
        message: string,
    ): void {
        if (
            message.startsWith(THINKING_LEVEL_STATUS_PREFIX) &&
            shouldShowThinkingLevelStatus() === false
        ) {
            return;
        }
        showStatus.call(this, message);
    };
    prototype[STATUS_PATCH_MARKER] = true;
}
