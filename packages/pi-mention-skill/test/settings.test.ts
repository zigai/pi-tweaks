import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, test } from "vitest";

import { loadMentionSkillSettings, type MentionSkillSettingsContext } from "../src/settings.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const globalConfigPath = path.join(agentDir, "extension-settings", "pi-mention-skill.json");
const globalSchemaPath = path.join(
    agentDir,
    "extension-settings",
    "schemas",
    "pi-mention-skill.schema.json",
);

beforeEach(async () => {
    await rm(path.join(agentDir, "extension-settings"), { recursive: true, force: true });
});

afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
    if (originalAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
});

function context(cwd: string, projectTrusted: boolean): MentionSkillSettingsContext {
    return {
        cwd,
        isProjectTrusted() {
            return projectTrusted;
        },
    };
}

async function writeJson(filePath: string, value: Record<string, unknown>): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(value), "utf8");
}

test("loadMentionSkillSettings uses defaults and scaffolds global config", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        assert.deepEqual(loadMentionSkillSettings(context(cwd, true)), {
            trigger: "$",
            hideSlashSkills: true,
            completionSuffix: " ",
        });
        assert.deepEqual(JSON.parse(await readFile(globalConfigPath, "utf8")), {
            $schema: "./schemas/pi-mention-skill.schema.json",
            trigger: "$",
            hideSlashSkills: true,
            completionSuffix: " ",
        });
        assert.match(await readFile(globalSchemaPath, "utf8"), /Pi Mention Skill settings/);

        const customConfig = JSON.stringify({ trigger: "#", hideSlashSkills: false });
        await writeFile(globalConfigPath, customConfig, "utf8");
        await writeFile(globalSchemaPath, "stale schema", "utf8");

        assert.deepEqual(loadMentionSkillSettings(context(cwd, true)), {
            trigger: "#",
            hideSlashSkills: false,
            completionSuffix: " ",
        });
        assert.equal(await readFile(globalConfigPath, "utf8"), customConfig);
        assert.match(await readFile(globalSchemaPath, "utf8"), /Pi Mention Skill settings/);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("loadMentionSkillSettings falls back when config becomes unreadable", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        await writeJson(globalConfigPath, {
            trigger: "#",
            hideSlashSkills: false,
        });

        assert.deepEqual(loadMentionSkillSettings(context(cwd, true)), {
            trigger: "#",
            hideSlashSkills: false,
            completionSuffix: " ",
        });

        await chmod(globalConfigPath, 0);

        assert.deepEqual(loadMentionSkillSettings(context(cwd, true)), {
            trigger: "$",
            hideSlashSkills: true,
            completionSuffix: " ",
        });
    } finally {
        await chmod(globalConfigPath, 0o600).catch(() => undefined);
        await rm(cwd, { recursive: true, force: true });
    }
});

test("loadMentionSkillSettings applies global settings and trusted project overrides", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        await writeJson(globalConfigPath, {
            trigger: "#",
            hideSlashSkills: false,
            completionSuffix: "\n",
        });
        await writeJson(path.join(cwd, ".pi", "extension-settings", "pi-mention-skill.json"), {
            trigger: "%",
            completionSuffix: "",
        });

        assert.deepEqual(loadMentionSkillSettings(context(cwd, true)), {
            trigger: "%",
            hideSlashSkills: false,
            completionSuffix: "",
        });
        assert.deepEqual(loadMentionSkillSettings(context(cwd, false)), {
            trigger: "#",
            hideSlashSkills: false,
            completionSuffix: "\n",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("loadMentionSkillSettings ignores invalid custom keys", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        await writeJson(globalConfigPath, {
            trigger: "/",
            hideSlashSkills: "no",
            completionSuffix: false,
        });

        assert.deepEqual(loadMentionSkillSettings(context(cwd, true)), {
            trigger: "$",
            hideSlashSkills: true,
            completionSuffix: " ",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("loadMentionSkillSettings rejects unknown config keys", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-settings-cwd-"));
    try {
        await writeJson(globalConfigPath, {
            trigger: "#",
            hideSlashSkillz: false,
        });

        assert.deepEqual(loadMentionSkillSettings(context(cwd, true)), {
            trigger: "$",
            hideSlashSkills: true,
            completionSuffix: " ",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
