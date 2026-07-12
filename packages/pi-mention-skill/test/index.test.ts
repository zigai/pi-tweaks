import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import mentionSkillExtension, { type MentionSkillExtensionApi } from "../src/index.ts";
import type { MentionSkillSettingsContext } from "../src/settings.ts";
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

function context(cwd: string): MentionSkillSettingsContext {
    return {
        cwd,
        isProjectTrusted() {
            return true;
        },
    };
}

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isContextExpansionResult(value: unknown): value is ContextExpansionResult {
    if (!isObject(value)) {
        return false;
    }

    const messages = Object.getOwnPropertyDescriptor(value, "messages")?.value as unknown;
    return messages === undefined || Array.isArray(messages);
}

function invokeRegisteredHandler(
    handlers: ReadonlyMap<string, unknown>,
    event: string,
    args: unknown[],
): unknown {
    const handler = handlers.get(event);
    if (typeof handler !== "function") throw new Error(`Expected ${event} handler`);
    return Reflect.apply(handler, undefined, args) as unknown;
}

test("mention skill skips command enumeration when provider context has no trigger", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-index-cwd-"));
    let getCommandsCount = 0;

    try {
        const registeredHandlers = new Map<string, unknown>();
        const pi: MentionSkillExtensionApi = {
            on(event, handler) {
                registeredHandlers.set(event, handler);
            },
            getCommands() {
                getCommandsCount += 1;
                return [];
            },
        };
        mentionSkillExtension(pi);
        assert.deepEqual([...registeredHandlers.keys()], ["session_start", "context"]);

        const messages: ContextEvent["messages"] = [
            {
                role: "user",
                content: [{ type: "text", text: "Please use a suitable skill" }],
                timestamp: 1,
            },
        ];
        const result = await invokeRegisteredHandler(registeredHandlers, "context", [
            { type: "context", messages },
            context(cwd),
        ]);

        assert.equal(result, undefined);
        assert.equal(getCommandsCount, 0);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("mention skill expands provider context without registering an input rewrite", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-index-cwd-"));
    const skillPath = path.join(cwd, "python.md");
    try {
        await writeFile(skillPath, "Use Python carefully.\n", "utf8");
        const registeredHandlers = new Map<string, unknown>();
        const pi: MentionSkillExtensionApi = {
            on(event, handler) {
                registeredHandlers.set(event, handler);
            },
            getCommands() {
                return [skillCommand("python", skillPath)];
            },
        };
        mentionSkillExtension(pi);
        assert.deepEqual([...registeredHandlers.keys()], ["session_start", "context"]);

        const messages: ContextEvent["messages"] = [
            {
                role: "user",
                content: [{ type: "text", text: "Please use $python" }],
                timestamp: 1,
            },
        ];
        const result = await invokeRegisteredHandler(registeredHandlers, "context", [
            { type: "context", messages },
            context(cwd),
        ]);

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
