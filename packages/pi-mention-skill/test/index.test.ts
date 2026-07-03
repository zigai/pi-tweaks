import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import mentionSkillExtension from "../src/index.ts";
import type { SkillCommand } from "../src/types.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-mention-index-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

type RegisteredHandler = (...args: unknown[]) => unknown;

type ContextExpansionResult = {
    readonly messages?: ContextEvent["messages"];
};

function skillCommand(name: string, filePath: string, description = "test skill"): SkillCommand {
    const skillName: `skill:${string}` = `skill:${name}`;
    return {
        source: "skill",
        name: skillName,
        description,
        sourceInfo: {
            path: filePath,
            source: "skill",
            scope: "project",
            origin: "top-level",
            baseDir: path.dirname(filePath),
        },
    };
}

function context(cwd: string): ExtensionContext {
    return {
        cwd,
        isProjectTrusted() {
            return true;
        },
    } as unknown as ExtensionContext;
}

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isContextExpansionResult(value: unknown): value is ContextExpansionResult {
    if (!isObject(value)) {
        return false;
    }

    const messages = Reflect.get(value, "messages");
    return messages === undefined || Array.isArray(messages);
}

test("mention skill skips command enumeration when provider context has no trigger", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-index-cwd-"));
    const registeredHandlers = new Map<string, RegisteredHandler[]>();
    let getCommandsCount = 0;

    try {
        const pi = {
            on(event: string, handler: RegisteredHandler) {
                const handlers = registeredHandlers.get(event) ?? [];
                handlers.push(handler);
                registeredHandlers.set(event, handlers);
            },
            getCommands() {
                getCommandsCount += 1;
                return [];
            },
        } as unknown as ExtensionAPI;

        mentionSkillExtension(pi);
        const contextHandler = registeredHandlers.get("context")?.[0];
        assert.notEqual(contextHandler, undefined);
        if (contextHandler === undefined) assert.fail("expected context handler");

        const messages: ContextEvent["messages"] = [
            {
                role: "user",
                content: [{ type: "text", text: "Please use a suitable skill" }],
                timestamp: 1,
            },
        ];
        const result = await contextHandler({ type: "context", messages }, context(cwd));

        assert.equal(result, undefined);
        assert.equal(getCommandsCount, 0);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("mention skill expands provider context without registering an input rewrite", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-index-cwd-"));
    const skillPath = path.join(cwd, "python.md");
    const registeredHandlers = new Map<string, RegisteredHandler[]>();

    try {
        await writeFile(skillPath, "Use Python carefully.\n", "utf8");
        const pi = {
            on(event: string, handler: RegisteredHandler) {
                const handlers = registeredHandlers.get(event) ?? [];
                handlers.push(handler);
                registeredHandlers.set(event, handlers);
            },
            getCommands() {
                return [skillCommand("python", skillPath)];
            },
        } as unknown as ExtensionAPI;

        mentionSkillExtension(pi);

        assert.equal((registeredHandlers.get("input") ?? []).length, 0);
        const contextHandlers = registeredHandlers.get("context") ?? [];
        assert.equal(contextHandlers.length, 1);
        const contextHandler = contextHandlers[0];
        assert.notEqual(contextHandler, undefined);
        if (contextHandler === undefined) assert.fail("expected context handler");

        const messages: ContextEvent["messages"] = [
            {
                role: "user",
                content: [{ type: "text", text: "Please use $python" }],
                timestamp: 1,
            },
        ];
        const result = await contextHandler({ type: "context", messages }, context(cwd));

        assert.equal(messages[0]?.role, "user");
        if (messages[0]?.role === "user" && Array.isArray(messages[0].content)) {
            assert.equal(messages[0].content[0]?.type, "text");
            if (messages[0].content[0]?.type === "text") {
                assert.equal(messages[0].content[0].text, "Please use $python");
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
        assert.match(text.text, /^<skill name="python"/);
        assert.match(text.text, /Please use python$/);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
