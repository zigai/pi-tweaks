import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
    installLinkedMethodPatch,
    type LinkedMethodPatchHandle,
} from "@zigai/pi-extension-internals";

const SLASH_COMMAND_SOURCE_PATCH = Symbol.for("zigai.pi-ui-tweaks.slash-command-source-patch");

export type SlashCommandSourceConfig = { readonly hideSlashCommandSourceTags: boolean };
export type SlashCommandSourceHandle = {
    update(config: SlashCommandSourceConfig): void;
    dispose(): void;
};

type PrefixAutocompleteDescription = (
    this: SlashCommandSourcePatchTarget,
    description: string | undefined,
    sourceInfo: unknown,
) => string | undefined;
type SlashCommandSourcePatchTarget = {
    prefixAutocompleteDescription: PrefixAutocompleteDescription;
    [SLASH_COMMAND_SOURCE_PATCH]?: SlashCommandSourcePatchRecord;
};
type SlashCommandSourcePatchRecord = {
    readonly original: PrefixAutocompleteDescription;
    readonly patch: LinkedMethodPatchHandle<
        SlashCommandSourcePatchTarget,
        [string | undefined, unknown],
        string | undefined
    >;
    readonly handle: SlashCommandSourceHandle;
};

function warnSlashCommandSourcePatchUnavailable(reason?: string): void {
    let suffix = "";
    if (reason !== undefined) suffix = `: ${reason}`;
    console.warn(
        `[pi-ui-tweaks] slash command source patch unavailable; Pi internals may have changed${suffix}`,
    );
}

/** Installs or updates the slash-command source-tag patch. */
export function installSlashCommandSourcePatch(
    config: SlashCommandSourceConfig,
    target: unknown = InteractiveMode.prototype,
): SlashCommandSourceHandle {
    if ((typeof target !== "object" && typeof target !== "function") || target === null) {
        warnSlashCommandSourcePatchUnavailable();
        return { update(): void {}, dispose(): void {} };
    }
    const prefix: unknown = Reflect.get(target, "prefixAutocompleteDescription");
    if (typeof prefix !== "function") {
        warnSlashCommandSourcePatchUnavailable("missing prefixAutocompleteDescription");
        return { update(): void {}, dispose(): void {} };
    }
    // SAFETY: The runtime guard proves the private InteractiveMode method is callable.
    const prototype = target as SlashCommandSourcePatchTarget;
    const installed = prototype[SLASH_COMMAND_SOURCE_PATCH];
    if (installed !== undefined) {
        installed.handle.update(config);
        return installed.handle;
    }
    let current = config;
    const patch = installLinkedMethodPatch(
        prototype,
        "prefixAutocompleteDescription",
        (predecessor) =>
            function patchedPrefixAutocompleteDescription(
                this: SlashCommandSourcePatchTarget,
                description: string | undefined,
                sourceInfo: unknown,
            ): string | undefined {
                if (current.hideSlashCommandSourceTags) return description;
                return predecessor.call(this, description, sourceInfo);
            },
    );
    let disposed = false;
    const handle: SlashCommandSourceHandle = {
        update(next): void {
            if (!disposed) current = next;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            patch.dispose();
            if (prototype[SLASH_COMMAND_SOURCE_PATCH]?.handle === handle) {
                delete prototype[SLASH_COMMAND_SOURCE_PATCH];
            }
        },
    };
    prototype[SLASH_COMMAND_SOURCE_PATCH] = { original: patch.predecessor, patch, handle };
    return handle;
}
