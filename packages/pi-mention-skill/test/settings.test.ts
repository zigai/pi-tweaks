import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configuredMentionSkillSettings } from "../src/settings.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

beforeEach(async () => {
    await rm(path.join(agentDir, "settings.json"), { force: true });
});

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

function context(cwd: string, projectTrusted: boolean): ExtensionContext {
    return {
        cwd,
        isProjectTrusted() {
            return projectTrusted;
        },
    } as unknown as ExtensionContext;
}

async function writeJson(filePath: string, value: Record<string, unknown>): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(value), "utf8");
}

test("configuredMentionSkillSettings uses defaults when settings are absent", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        assert.deepEqual(configuredMentionSkillSettings(context(cwd, true)), {
            trigger: "$",
            hideSlashSkills: true,
            completionSuffix: " ",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("configuredMentionSkillSettings applies global settings and trusted project overrides", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        await writeJson(path.join(agentDir, "settings.json"), {
            mentionSkillTrigger: "#",
            mentionSkillHideSlashSkills: false,
            mentionSkillCompletionSuffix: "\n",
        });
        await writeJson(path.join(cwd, ".pi", "settings.json"), {
            mentionSkillTrigger: "%",
            mentionSkillCompletionSuffix: "",
        });

        assert.deepEqual(configuredMentionSkillSettings(context(cwd, true)), {
            trigger: "%",
            hideSlashSkills: false,
            completionSuffix: "",
        });
        assert.deepEqual(configuredMentionSkillSettings(context(cwd, false)), {
            trigger: "#",
            hideSlashSkills: false,
            completionSuffix: "\n",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("configuredMentionSkillSettings ignores invalid custom keys", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        await writeJson(path.join(agentDir, "settings.json"), {
            mentionSkillTrigger: "/",
            mentionSkillHideSlashSkills: "no",
            mentionSkillCompletionSuffix: false,
        });

        assert.deepEqual(configuredMentionSkillSettings(context(cwd, true)), {
            trigger: "$",
            hideSlashSkills: true,
            completionSuffix: " ",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
