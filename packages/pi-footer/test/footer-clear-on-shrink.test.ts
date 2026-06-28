import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installLiveFooter } from "../src/footer-transition.ts";
import type { FooterData } from "../src/types.ts";

type TestTui = {
    requestRender(): void;
    setClearOnShrink(enabled: boolean): void;
};

type CapturedFooterFactory = (tui: TestTui, theme: unknown, footerData: FooterData) => unknown;

void test("live footer enables Pi native clear-on-shrink rendering", () => {
    let capturedFactory: CapturedFooterFactory | undefined;

    const ctx = {
        cwd: "/tmp/project",
        model: {
            provider: "test-provider",
            id: "test-model",
            contextWindow: 1000,
        },
        getContextUsage() {
            return undefined;
        },
        ui: {
            setFooter(factory: CapturedFooterFactory | undefined): void {
                capturedFactory = factory;
            },
        },
    } as unknown as ExtensionContext;

    installLiveFooter(ctx, () => "medium");

    if (capturedFactory === undefined) {
        assert.fail("expected footer factory to be registered");
    }

    let clearOnShrinkEnabled = false;
    const tui: TestTui = {
        requestRender() {},
        setClearOnShrink(enabled: boolean) {
            clearOnShrinkEnabled = enabled;
        },
    };
    const footerData: FooterData = {
        getGitBranch() {
            return "main";
        },
        getExtensionStatuses() {
            return new Map();
        },
        onBranchChange() {
            return () => {};
        },
    };

    capturedFactory(tui, {}, footerData);

    assert.equal(clearOnShrinkEnabled, true);
});
