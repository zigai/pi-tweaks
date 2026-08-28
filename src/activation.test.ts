import { describe, expect, test } from "vitest";

import { activateTweakFactories, type TweakEntry } from "./activation.ts";

type TestApi = {
    readonly registrations: string[];
    readonly shutdownHandlers: Array<() => void>;
    readonly restored: string[];
};

describe("aggregate tweak activation", () => {
    test("continues after failures and preserves registrations and shutdown restoration", async () => {
        const api: TestApi = {
            registrations: [],
            shutdownHandlers: [],
            restored: [],
        };
        const firstCause = new Error("first cause");
        const secondCause = new Error("second cause");
        const attempts: string[] = [];
        const tweaks: readonly TweakEntry<TestApi>[] = [
            {
                name: "first-success",
                factory: (currentApi) => {
                    attempts.push("first-success");
                    currentApi.registrations.push("first-success");
                    currentApi.shutdownHandlers.push(() => {
                        currentApi.restored.push("first-success");
                    });
                },
            },
            {
                name: "first-failure",
                factory: () => {
                    attempts.push("first-failure");
                    throw firstCause;
                },
            },
            {
                name: "second-success",
                factory: async (currentApi) => {
                    await Promise.resolve();
                    attempts.push("second-success");
                    currentApi.registrations.push("second-success");
                    currentApi.shutdownHandlers.push(() => {
                        currentApi.restored.push("second-success");
                    });
                },
            },
            {
                name: "second-failure",
                factory: () => {
                    attempts.push("second-failure");
                    throw secondCause;
                },
            },
        ];

        let caught: unknown;
        try {
            await activateTweakFactories(api, tweaks);
        } catch (error: unknown) {
            caught = error;
        }

        expect(attempts).toEqual([
            "first-success",
            "first-failure",
            "second-success",
            "second-failure",
        ]);
        expect(api.registrations).toEqual(["first-success", "second-success"]);
        expect(caught).toBeInstanceOf(AggregateError);
        if (!(caught instanceof AggregateError)) {
            throw new Error("activation must report an AggregateError");
        }
        const failures: unknown = caught.errors;
        if (!Array.isArray(failures)) {
            throw new Error("AggregateError.errors must be an array");
        }
        expect(failures).toHaveLength(2);
        expect(failures[0]).toMatchObject({
            message: "first-failure could not be activated",
            cause: firstCause,
        });
        expect(failures[1]).toMatchObject({
            message: "second-failure could not be activated",
            cause: secondCause,
        });

        for (const restore of api.shutdownHandlers) restore();
        expect(api.restored).toEqual(["first-success", "second-success"]);
    });
});
