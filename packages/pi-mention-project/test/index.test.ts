import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import {
    CONFIG_DIR_NAME,
    type ContextEvent,
    type ExtensionAPI,
    type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import mentionProjectExtension, { createProjectMentionContextHandler } from "../src/index.ts";
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

type RegisteredHandler = (...args: unknown[]) => unknown;

type ContextExpansionResult = {
    readonly messages?: ContextEvent["messages"];
};

function extensionApi(): ExtensionAPI {
    return {
        getFlag() {
            return false;
        },
    } as unknown as ExtensionAPI;
}

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isContextExpansionResult(value: unknown): value is ContextExpansionResult {
    if (!isObject(value)) return false;

    const messages = Reflect.get(value, "messages");
    return messages === undefined || Array.isArray(messages);
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

test("context handler scans and expands past user messages after the trigger is present", async () => {
    let loadCount = 0;
    const handler = createProjectMentionContextHandler(extensionApi(), async () => {
        loadCount += 1;
        return [project("pi-tweaks"), project("work-api")];
    });
    const messages: ContextEvent["messages"] = [
        {
            role: "user",
            content: [{ type: "text", text: "Earlier we discussed #pi-tweaks" }],
            timestamp: 1,
        },
        {
            role: "user",
            content: [{ type: "text", text: "Now compare it with #work-api" }],
            timestamp: 2,
        },
    ];

    const result = await handler({ type: "context", messages }, context(process.cwd()));

    assert.equal(loadCount, 1);
    assert.notEqual(result, undefined);
    const firstExpanded = result?.messages[0];
    assert.equal(firstExpanded?.role, "user");
    if (firstExpanded?.role !== "user" || !Array.isArray(firstExpanded.content)) {
        assert.fail("expected expanded past user text message");
    }
    const firstText = firstExpanded.content[0];
    assert.equal(firstText?.type, "text");
    if (firstText?.type !== "text") assert.fail("expected past text content");
    assert.equal(firstText.text, "Earlier we discussed /tmp/projects/pi-tweaks");

    const latestExpanded = result?.messages[1];
    assert.equal(latestExpanded?.role, "user");
    if (latestExpanded?.role !== "user" || !Array.isArray(latestExpanded.content)) {
        assert.fail("expected expanded latest user text message");
    }
    const latestText = latestExpanded.content[0];
    assert.equal(latestText?.type, "text");
    if (latestText?.type !== "text") assert.fail("expected latest text content");
    assert.equal(latestText.text, "Now compare it with /tmp/projects/work-api");
});

test("mention project keeps hashtag prompts in history and expands provider context", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-index-cwd-"));
    const registeredHandlers = new Map<string, RegisteredHandler[]>();

    try {
        await mkdir(path.join(cwd, "pi-tweaks", ".git"), { recursive: true });
        const configDir = path.join(cwd, CONFIG_DIR_NAME, "pi-mention-project");
        await mkdir(configDir, { recursive: true });
        await writeFile(
            path.join(configDir, "config.json"),
            JSON.stringify({ roots: ["."], gitReposOnly: true }),
            "utf8",
        );

        const pi = {
            registerFlag() {},
            getFlag() {
                return false;
            },
            on(event: string, handler: RegisteredHandler) {
                const handlers = registeredHandlers.get(event) ?? [];
                handlers.push(handler);
                registeredHandlers.set(event, handlers);
            },
        } as unknown as ExtensionAPI;

        mentionProjectExtension(pi);

        assert.equal((registeredHandlers.get("input") ?? []).length, 0);
        const contextHandlers = registeredHandlers.get("context") ?? [];
        assert.equal(contextHandlers.length, 1);
        const contextHandler = contextHandlers[0];
        assert.notEqual(contextHandler, undefined);
        if (contextHandler === undefined) assert.fail("expected context handler");

        const messages: ContextEvent["messages"] = [
            {
                role: "user",
                content: [{ type: "text", text: "Please inspect #pi-tweaks" }],
                timestamp: 1,
            },
        ];
        const result = await contextHandler({ type: "context", messages }, context(cwd));

        const original = messages[0];
        assert.equal(original?.role, "user");
        if (original?.role === "user" && Array.isArray(original.content)) {
            assert.equal(original.content[0]?.type, "text");
            if (original.content[0]?.type === "text") {
                assert.equal(original.content[0].text, "Please inspect #pi-tweaks");
            }
        }
        assert.equal(isContextExpansionResult(result), true);
        if (!isContextExpansionResult(result)) assert.fail("expected context expansion result");
        const expandedMessages = result.messages;
        assert.notEqual(expandedMessages, undefined);
        if (expandedMessages === undefined) assert.fail("expected expanded messages");
        const expanded = expandedMessages[0];
        assert.equal(expanded?.role, "user");
        if (expanded?.role !== "user" || !Array.isArray(expanded.content)) {
            assert.fail("expected expanded user text message");
        }
        const text = expanded.content[0];
        assert.equal(text?.type, "text");
        if (text?.type !== "text") assert.fail("expected text content");
        assert.equal(text.text, `Please inspect ${path.join(cwd, "pi-tweaks")}`);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
