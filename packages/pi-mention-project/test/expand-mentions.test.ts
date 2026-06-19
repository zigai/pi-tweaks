import assert from "node:assert/strict";
import test from "node:test";

import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import { expandProjectMentions, expandProjectMentionsInMessages } from "../src/expand-mentions.ts";
import type { ProjectDirectory } from "../src/types.ts";

function project(name: string, root = "/tmp/projects"): ProjectDirectory {
    return {
        name,
        root,
        path: `${root}/${name}`,
    };
}

void test("expandProjectMentions replaces known project mentions with absolute paths", () => {
    const expanded = expandProjectMentions(
        "Please inspect #pi-tweaks, ignore #unknown, then #pi-tweaks.",
        [project("pi-tweaks")],
        "#",
    );

    assert.equal(
        expanded,
        "Please inspect /tmp/projects/pi-tweaks, ignore #unknown, then /tmp/projects/pi-tweaks.",
    );
});

void test("expandProjectMentions replaces multiple projects and supports regex-special triggers", () => {
    const expanded = expandProjectMentions("+one and +two?", [project("one"), project("two")], "+");

    assert.equal(expanded, "/tmp/projects/one and /tmp/projects/two?");
});

void test("expandProjectMentions supports quoted project names", () => {
    const expanded = expandProjectMentions(
        'Check #"My Project" today.',
        [project("My Project")],
        "#",
    );

    assert.equal(expanded, "Check /tmp/projects/My Project today.");
});

void test("expandProjectMentions replaces project mentions for configured project roots", () => {
    const expanded = expandProjectMentions(
        "#zgod #sesh #gameops verify it for these projects too",
        [
            project("zgod", "/home/zigai/Projects"),
            project("sesh", "/home/zigai/Projects"),
            project("gameops", "/home/zigai/Projects"),
        ],
        "#",
    );

    assert.equal(
        expanded,
        "/home/zigai/Projects/zgod /home/zigai/Projects/sesh /home/zigai/Projects/gameops verify it for these projects too",
    );
});

void test("expandProjectMentions returns original text when no known mentions are present", () => {
    const expanded = expandProjectMentions("Use #missing", [], "#");

    assert.equal(expanded, "Use #missing");
});

void test("expandProjectMentionsInMessages expands user text without mutating queued display text", () => {
    const messages: ContextEvent["messages"] = [
        {
            role: "user",
            content: [{ type: "text", text: "Please inspect #pi-tweaks" }],
            timestamp: 1,
        },
    ];

    const expanded = expandProjectMentionsInMessages(messages, [project("pi-tweaks")], "#");

    const original = messages[0];
    assert.equal(original?.role, "user");
    if (original?.role === "user" && Array.isArray(original.content)) {
        assert.equal(original.content[0]?.type, "text");
        if (original.content[0]?.type === "text") {
            assert.equal(original.content[0].text, "Please inspect #pi-tweaks");
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
    assert.equal(text.text, "Please inspect /tmp/projects/pi-tweaks");
});

void test("expandProjectMentionsInMessages leaves existing project blocks alone", () => {
    const messages: ContextEvent["messages"] = [
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: '<project name="existing" path="/tmp/existing">\nMentions #pi-tweaks.\n</project>',
                },
            ],
            timestamp: 1,
        },
    ];

    const expanded = expandProjectMentionsInMessages(messages, [project("pi-tweaks")], "#");

    assert.equal(expanded, messages);
});
