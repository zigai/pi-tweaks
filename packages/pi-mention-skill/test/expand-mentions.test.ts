import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import { expandSkillMentions, expandSkillMentionsInMessages } from "../src/expand-mentions.ts";
import { stripFrontmatter } from "../src/skill-commands.ts";
import type { SkillCommand } from "../src/types.ts";

function skillCommand(name: string, filePath: string, description = "test skill"): SkillCommand {
    return {
        source: "skill",
        name: `skill:${name}`,
        description,
        sourceInfo: {
            path: filePath,
            baseDir: path.dirname(filePath),
        },
    } as unknown as SkillCommand;
}

test("stripFrontmatter removes yaml blocks and preserves ordinary markdown", () => {
    assert.equal(stripFrontmatter("# No frontmatter\nBody"), "# No frontmatter\nBody");
    assert.equal(stripFrontmatter("---\nname: demo\n---\nBody"), "Body");
    assert.equal(stripFrontmatter("---\r\nname: demo\r\n---\r\nBody"), "Body");
});

test("expandSkillMentions prepends known skills once and removes only known sigils", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-mention-skill-"));
    try {
        const filePath = path.join(dir, "python.md");
        await writeFile(filePath, "---\nname: python\n---\nUse Python carefully.\n", "utf8");
        const expanded = await expandSkillMentions(
            "Please use $python, ignore $unknown, then $python.",
            [skillCommand("python", filePath)],
            "$",
        );

        assert.match(expanded, /^<skill name="python"/);
        assert.match(expanded, /References are relative to /);
        assert.match(expanded, /Use Python carefully\./);
        assert.equal(expanded.includes("name: python"), false);
        assert.match(expanded, /Please use python, ignore \$unknown, then python\.$/);
        assert.equal(expanded.match(/Use Python carefully\./g)?.length, 1);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("expandSkillMentions combines multiple skills and supports regex-special triggers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-mention-skill-"));
    try {
        const firstPath = path.join(dir, "one.md");
        const secondPath = path.join(dir, "two.md");
        await writeFile(firstPath, "First body\n", "utf8");
        await writeFile(secondPath, "Second body\n", "utf8");

        const expanded = await expandSkillMentions(
            "+one and +two?",
            [skillCommand("one", firstPath), skillCommand("two", secondPath)],
            "+",
        );

        assert.match(expanded, /^<skill name="one, two" location="multiple">/);
        assert.match(expanded, /## one\n\nReferences are relative to /);
        assert.match(expanded, /First body/);
        assert.match(expanded, /## two\n\nReferences are relative to /);
        assert.match(expanded, /Second body/);
        assert.match(expanded, /one and two\?$/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("expandSkillMentions returns original text when no known mentions are present", async () => {
    const expanded = await expandSkillMentions("Use $missing", [], "$");

    assert.equal(expanded, "Use $missing");
});

test("expandSkillMentionsInMessages expands user text without mutating queued display text", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-mention-skill-"));
    try {
        const filePath = path.join(dir, "python.md");
        await writeFile(filePath, "Use Python carefully.\n", "utf8");
        const messages: ContextEvent["messages"] = [
            {
                role: "user",
                content: [{ type: "text", text: "Please use $python" }],
                timestamp: 1,
            },
        ];

        const expanded = await expandSkillMentionsInMessages(
            messages,
            [skillCommand("python", filePath)],
            "$",
        );

        const original = messages[0];
        assert.equal(original?.role, "user");
        if (original?.role === "user" && Array.isArray(original.content)) {
            assert.equal(original.content[0]?.type, "text");
            if (original.content[0]?.type === "text") {
                assert.equal(original.content[0].text, "Please use $python");
            }
        }

        assert.notEqual(expanded, messages);
        const message = expanded[0];
        assert.equal(message?.role, "user");
        if (message?.role !== "user" || !Array.isArray(message.content)) {
            assert.fail("expected expanded user message with array content");
        }
        const text = message.content[0];
        assert.equal(text?.type, "text");
        if (text?.type !== "text") assert.fail("expected text content");
        assert.match(text.text, /^<skill name="python"/);
        assert.match(text.text, /Please use python$/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("expandSkillMentionsInMessages leaves existing skill blocks alone", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-mention-skill-"));
    try {
        const filePath = path.join(dir, "python.md");
        await writeFile(filePath, "Use Python carefully.\n", "utf8");
        const messages: ContextEvent["messages"] = [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: '<skill name="existing" location="/tmp/existing.md">\nMentions $python.\n</skill>',
                    },
                ],
                timestamp: 1,
            },
        ];

        const expanded = await expandSkillMentionsInMessages(
            messages,
            [skillCommand("python", filePath)],
            "$",
        );

        assert.equal(expanded, messages);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
