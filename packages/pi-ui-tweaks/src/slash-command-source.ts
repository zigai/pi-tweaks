import { InteractiveMode } from "@earendil-works/pi-coding-agent";

import { getUiTweaksPatchState } from "./patch-state.ts";

const SLASH_COMMAND_SOURCE_PATCH_KEY = Symbol.for(
    "zigai.pi-ui-tweaks.slash-command-source-patched",
);

type PrefixAutocompleteDescription = (
    description: string | undefined,
    sourceInfo: unknown,
) => string | undefined;

type SlashCommandSourcePatchTarget = {
    [SLASH_COMMAND_SOURCE_PATCH_KEY]?: true;
    prefixAutocompleteDescription: PrefixAutocompleteDescription;
};

function warnSlashCommandSourcePatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined && reason.length > 0) {
        suffix = `: ${reason}`;
    }

    console.warn(
        `[pi-ui-tweaks] slash command source patch unavailable; Pi internals may have changed${suffix}`,
    );
}

/**
 * Sets whether slash command autocomplete descriptions should hide source tags.
 */
export function setHideSlashCommandSourceTags(enabled: boolean): void {
    getUiTweaksPatchState().hideSlashCommandSourceTags = enabled;
}

/**
 * Installs an idempotent patch that removes source tags from slash command autocomplete rows.
 */
export function installSlashCommandSourcePatch(
    prototype: SlashCommandSourcePatchTarget = InteractiveMode.prototype as unknown as SlashCommandSourcePatchTarget,
): void {
    if (prototype[SLASH_COMMAND_SOURCE_PATCH_KEY] === true) {
        return;
    }

    const originalPrefixValue: unknown = Reflect.get(prototype, "prefixAutocompleteDescription");
    if (typeof originalPrefixValue !== "function") {
        warnSlashCommandSourcePatchUnavailable("missing prefixAutocompleteDescription");
        return;
    }

    // SAFETY: Pi's InteractiveMode currently exposes this private TypeScript method at runtime.
    // The guard above verifies the method before this internal UI patch wraps it.
    const originalPrefix = originalPrefixValue as PrefixAutocompleteDescription;

    prototype.prefixAutocompleteDescription = function patchedPrefixAutocompleteDescription(
        this: SlashCommandSourcePatchTarget,
        description: string | undefined,
        sourceInfo: unknown,
    ): string | undefined {
        if (getUiTweaksPatchState().hideSlashCommandSourceTags) {
            return description;
        }

        return originalPrefix.call(this, description, sourceInfo);
    };

    prototype[SLASH_COMMAND_SOURCE_PATCH_KEY] = true;
}
