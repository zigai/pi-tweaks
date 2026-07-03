import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, test } from "vitest";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { applyMentionProjectCliFlags, configuredMentionProjectSettings } from "../src/settings.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const globalConfigPath = path.join(agentDir, "pi-mention-project", "config.json");
const globalSchemaPath = path.join(agentDir, "pi-mention-project", "config.schema.json");

beforeEach(async () => {
    await rm(path.join(agentDir, "pi-mention-project"), { recursive: true, force: true });
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

test("configuredMentionProjectSettings uses defaults and scaffolds global config", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-cwd-"));
    try {
        assert.deepEqual(configuredMentionProjectSettings(context(cwd, true)), {
            trigger: "#",
            roots: [],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: " ",
        });
        assert.deepEqual(JSON.parse(await readFile(globalConfigPath, "utf8")), {
            $schema: "./config.schema.json",
            trigger: "#",
            roots: [],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: " ",
        });
        assert.match(await readFile(globalSchemaPath, "utf8"), /Pi project mention config/);

        const customConfig = JSON.stringify({ trigger: "@", roots: ["~/Projects"] });
        await writeFile(globalConfigPath, customConfig, "utf8");
        await writeFile(globalSchemaPath, "stale schema", "utf8");

        assert.deepEqual(configuredMentionProjectSettings(context(cwd, true)), {
            trigger: "@",
            roots: ["~/Projects"],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: " ",
        });
        assert.equal(await readFile(globalConfigPath, "utf8"), customConfig);
        assert.match(await readFile(globalSchemaPath, "utf8"), /Pi project mention config/);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
});

test("configuredMentionProjectSettings applies global settings and trusted project overrides", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-cwd-"));
    try {
        await writeJson(globalConfigPath, {
            trigger: "@",
            roots: ["~/Projects"],
            gitReposOnly: false,
            includeDotFolders: true,
            completionSuffix: "\n",
        });
        await writeJson(path.join(cwd, ".pi", "pi-mention-project", "config.json"), {
            trigger: "%",
            roots: ["./local-projects"],
            gitReposOnly: true,
            includeDotFolders: false,
            completionSuffix: "",
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
        await writeJson(globalConfigPath, {
            roots: ["~/Projects"],
        });
        await writeJson(path.join(cwd, ".pi", "pi-mention-project", "config.json"), {
            roots: [],
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
        await writeJson(globalConfigPath, {
            trigger: "/",
            roots: [""],
            gitReposOnly: "no",
            includeDotFolders: "yes",
            completionSuffix: false,
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

test("configuredMentionProjectSettings rejects unknown config keys", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-mention-project-settings-cwd-"));
    try {
        await writeJson(globalConfigPath, {
            trigger: "@",
            triggerTypo: "%",
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
