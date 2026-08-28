import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type TweakFactory<Api = ExtensionAPI> = (pi: Api) => void | Promise<void>;

export type TweakEntry<Api = ExtensionAPI> = {
    readonly name: string;
    readonly factory: TweakFactory<Api>;
};

/** Activates every tweak in order, retaining all failures until every factory has run. */
export async function activateTweakFactories<Api>(
    pi: Api,
    tweaks: readonly TweakEntry<Api>[],
): Promise<void> {
    const failures: Error[] = [];
    for (const tweak of tweaks) {
        try {
            await tweak.factory(pi);
        } catch (cause: unknown) {
            failures.push(
                new Error(`${tweak.name} could not be activated`, {
                    cause,
                }),
            );
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, "One or more Pi Tweaks could not be activated");
    }
}
