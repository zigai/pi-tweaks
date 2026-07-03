import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createProjectMentionContextHandler } from "../src/index.ts";
import type { ProjectDirectory } from "../src/types.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-mention-project-index-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

function context(cwd: string): ExtensionContext {
    return {
        cwd,
        isProjectTrusted() {
            return true;
        },
    } as unknown as ExtensionContext;
}

function project(name: string, root = "/tmp/projects"): ProjectDirectory {
    return {
        name,
        root,
        path: `${root}/${name}`,
    };
}

function extensionApi(): ExtensionAPI {
    return {
        getFlag() {
            return false;
        },
    } as unknown as ExtensionAPI;
}

test("context handler skips project directory scans when user messages have no trigger", async () => {
    let loadCount = 0;
    const handler = createProjectMentionContextHandler(extensionApi(), async () => {
        loadCount += 1;
        return [project("pi-tweaks")];
    });
    const messages: ContextEvent["messages"] = [
        {
            role: "user",
            content: [{ type: "text", text: "Please inspect the current workspace" }],
            timestamp: 1,
        },
    ];

    const result = await handler({ type: "context", messages }, context(process.cwd()));

    assert.equal(result, undefined);
    assert.equal(loadCount, 0);
});

test("context handler scans and expands only after the trigger is present", async () => {
    let loadCount = 0;
    const handler = createProjectMentionContextHandler(extensionApi(), async () => {
        loadCount += 1;
        return [project("pi-tweaks")];
    });
    const messages: ContextEvent["messages"] = [
        {
            role: "user",
            content: [{ type: "text", text: "Please inspect #pi-tweaks" }],
            timestamp: 1,
        },
    ];

    const result = await handler({ type: "context", messages }, context(process.cwd()));

    assert.equal(loadCount, 1);
    assert.notEqual(result, undefined);
    const expanded = result?.messages[0];
    assert.equal(expanded?.role, "user");
    if (expanded?.role !== "user" || !Array.isArray(expanded.content)) {
        assert.fail("expected expanded user text message");
    }
    const text = expanded.content[0];
    assert.equal(text?.type, "text");
    if (text?.type !== "text") assert.fail("expected text content");
    assert.equal(text.text, "Please inspect /tmp/projects/pi-tweaks");
});
