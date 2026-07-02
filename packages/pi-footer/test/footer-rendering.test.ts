import assert from "node:assert/strict";
import { test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createFooterComponent } from "../src/footer-rendering.ts";
import type { FooterContext, FooterData } from "../src/types.ts";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
    return value.replace(ANSI_PATTERN, "");
}

function footerContext(): ExtensionContext {
    return {
        cwd: "/workspace/pi-tweaks",
        model: {
            provider: "github-copilot",
            id: "gpt-5",
            contextWindow: 200_000,
        },
        getContextUsage() {
            return {
                percent: 75,
                contextWindow: 200_000,
            };
        },
        mcpServers: [{}, {}],
        modelRegistry: {
            getProviderDisplayName(provider: string) {
                if (provider === "github-copilot") return "copilot";
                return provider;
            },
        },
    } as unknown as ExtensionContext;
}

function footerData(branch: string | null, statuses: ReadonlyMap<string, string>): FooterData {
    return {
        getGitBranch() {
            return branch;
        },
        getExtensionStatuses() {
            return statuses;
        },
        onBranchChange() {
            return () => undefined;
        },
    };
}

test("createFooterComponent renders key session status without exceeding width", () => {
    const component = createFooterComponent(
        footerContext(),
        footerData("main", new Map([["mcp", "MCP:\n 2\tservers"]])),
        () => "medium",
        () => undefined,
    );

    const line = component.render(120)[0] ?? "";
    const plain = stripAnsi(line);

    assert.equal(visibleWidth(line) <= 118, true);
    assert.match(plain, /\/workspace\/pi-tweaks/);
    assert.match(plain, /main/);
    assert.match(plain, /copilot/);
    assert.match(plain, /gpt-5/);
    assert.match(plain, /medium/);
    assert.match(plain, /75\.0%\/200k/);
    assert.match(plain, /MCP: 2 servers/);
});

test("createFooterComponent renders configured plain separator", () => {
    const component = createFooterComponent(
        footerContext(),
        footerData("main", new Map()),
        () => "medium",
        () => undefined,
        { separator: "·" },
    );

    const line = component.render(120)[0] ?? "";
    const plain = stripAnsi(line);

    assert.match(plain, /pi-tweaks · .*main · .*copilot · .*gpt-5 · .*medium/);
    assert.doesNotMatch(plain, / \| /);
});

test("createFooterComponent prefers model display names over model ids", () => {
    const ctx: FooterContext = {
        cwd: "/workspace/pi-tweaks",
        model: {
            provider: "openai-codex",
            id: "gpt-5.5",
            name: "GPT-5.5",
            contextWindow: 200_000,
        },
        getContextUsage() {
            return {
                tokens: 150_000,
                percent: 75,
                contextWindow: 200_000,
            };
        },
    };
    const component = createFooterComponent(
        ctx,
        footerData(null, new Map()),
        () => "medium",
        () => undefined,
    );

    const line = component.render(120)[0] ?? "";
    const plain = stripAnsi(line);

    assert.match(plain, /GPT-5\.5/);
    assert.doesNotMatch(plain, /gpt-5\.5/);
});

test("createFooterComponent uses provider display names from the model registry", () => {
    const ctx: FooterContext = {
        cwd: "/workspace/pi-tweaks",
        model: {
            provider: "openai-codex",
            id: "gpt-5",
            contextWindow: 200_000,
        },
        modelRegistry: {
            getProviderDisplayName(provider: string) {
                if (provider === "openai-codex") return "Codex";
                return provider;
            },
        },
        getContextUsage() {
            return {
                tokens: 150_000,
                percent: 75,
                contextWindow: 200_000,
            };
        },
    };
    const component = createFooterComponent(
        ctx,
        footerData(null, new Map()),
        () => "medium",
        () => undefined,
    );

    const line = component.render(120)[0] ?? "";
    const plain = stripAnsi(line);

    assert.match(plain, /Codex/);
    assert.doesNotMatch(plain, /openai-codex/);
});

test("createFooterComponent uses snapshotted provider display names", () => {
    const ctx: FooterContext = {
        cwd: "/workspace/pi-tweaks",
        model: {
            provider: "openai-codex",
            providerDisplayName: "Codex",
            id: "gpt-5",
            contextWindow: 200_000,
        },
        getContextUsage() {
            return {
                tokens: 150_000,
                percent: 75,
                contextWindow: 200_000,
            };
        },
    };
    const component = createFooterComponent(
        ctx,
        footerData(null, new Map()),
        () => "medium",
        () => undefined,
    );

    const line = component.render(120)[0] ?? "";
    const plain = stripAnsi(line);

    assert.match(plain, /Codex/);
    assert.doesNotMatch(plain, /openai-codex/);
});

test("createFooterComponent preserves the primary path and drops optional narrow segments", () => {
    const component = createFooterComponent(
        footerContext(),
        footerData("feature/very-long-branch", new Map([["mcp", "MCP: connected"]])),
        () => "high",
        () => undefined,
    );

    const line = component.render(30)[0] ?? "";
    const plain = stripAnsi(line);

    assert.equal(visibleWidth(line) <= 28, true);
    assert.equal(plain.trim(), "/workspace/pi-tweaks");
    assert.doesNotMatch(plain, /feature\/very-long-branch/);
    assert.doesNotMatch(plain, /copilot/);
    assert.doesNotMatch(plain, /gpt-5/);
    assert.doesNotMatch(plain, /high/);
    assert.doesNotMatch(plain, /75\.0%\/200k/);
    assert.doesNotMatch(plain, /MCP: connected/);
});

test("createFooterComponent disposes the branch-change subscription", () => {
    let unsubscribed = false;
    const data: FooterData = {
        getGitBranch() {
            return null;
        },
        getExtensionStatuses() {
            return new Map();
        },
        onBranchChange() {
            return () => {
                unsubscribed = true;
            };
        },
    };

    const component = createFooterComponent(
        footerContext(),
        data,
        () => "off",
        () => undefined,
    );
    component.dispose();

    assert.equal(unsubscribed, true);
});
