import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { applyMentionProjectCliFlags, configuredMentionProjectSettings } from "../src/settings.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-agent-"));
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

test("configuredMentionProjectSettings uses defaults when settings are absent", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-cwd-"));
    try {
        assert.deepEqual(configuredMentionProjectSettings(context(cwd, true)), {
            trigger: "#",
            roots: [],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: " ",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("configuredMentionProjectSettings applies global settings and trusted project overrides", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-cwd-"));
    try {
        await writeJson(path.join(agentDir, "settings.json"), {
            mentionProjectTrigger: "@",
            mentionProjectRoots: ["~/Projects"],
            mentionProjectGitReposOnly: false,
            mentionProjectIncludeDotFolders: true,
            mentionProjectCompletionSuffix: "\n",
        });
        await writeJson(path.join(cwd, ".pi", "settings.json"), {
            mentionProjectTrigger: "%",
            mentionProjectRoots: ["./local-projects"],
            mentionProjectGitReposOnly: true,
            mentionProjectIncludeDotFolders: false,
            mentionProjectCompletionSuffix: "",
        });

        assert.deepEqual(configuredMentionProjectSettings(context(cwd, true)), {
            trigger: "%",
            roots: ["./local-projects"],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: "",
        });
        assert.deepEqual(configuredMentionProjectSettings(context(cwd, false)), {
            trigger: "@",
            roots: ["~/Projects"],
            gitReposOnly: false,
            includeDotFolders: true,
            completionSuffix: "\n",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("configuredMentionProjectSettings allows trusted project roots to clear global roots", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-cwd-"));
    try {
        await writeJson(path.join(agentDir, "settings.json"), {
            mentionProjectRoots: ["~/Projects"],
        });
        await writeJson(path.join(cwd, ".pi", "settings.json"), {
            mentionProjectRoots: [],
        });

        assert.deepEqual(configuredMentionProjectSettings(context(cwd, true)), {
            trigger: "#",
            roots: [],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: " ",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("applyMentionProjectCliFlags can relax project filters for one run", () => {
    assert.deepEqual(
        applyMentionProjectCliFlags(
            {
                trigger: "#",
                roots: ["~/Projects"],
                gitReposOnly: true,
                includeDotFolders: false,
                completionSuffix: " ",
            },
            { includeNonGit: true, includeDotFolders: true },
        ),
        {
            trigger: "#",
            roots: ["~/Projects"],
            gitReposOnly: false,
            includeDotFolders: true,
            completionSuffix: " ",
        },
    );
});

test("configuredMentionProjectSettings ignores invalid custom keys", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-cwd-"));
    try {
        await writeJson(path.join(agentDir, "settings.json"), {
            mentionProjectTrigger: "/",
            mentionProjectRoots: [""],
            mentionProjectGitReposOnly: "no",
            mentionProjectIncludeDotFolders: "yes",
            mentionProjectCompletionSuffix: false,
        });

        assert.deepEqual(configuredMentionProjectSettings(context(cwd, true)), {
            trigger: "#",
            roots: [],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: " ",
        });
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});
