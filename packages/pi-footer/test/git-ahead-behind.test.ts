import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import { createGitAheadBehindTracker, formatGitAheadBehind } from "../src/git-ahead-behind.ts";

function waitForMicrotask(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
    await execFileAsync("git", args, { cwd, windowsHide: true });
}

async function getGitOutput(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
    return stdout;
}

test("formatGitAheadBehind displays both upstream commit counts", () => {
    assert.equal(formatGitAheadBehind({ ahead: 7, behind: 4 }), "↑7 ↓4");
});

test("createGitAheadBehindTracker reads counts from a branch upstream", async () => {
    const worktree = await mkdtemp(path.join(tmpdir(), "pi-footer-git-"));
    const remote = await mkdtemp(path.join(tmpdir(), "pi-footer-remote-"));
    const collaborator = await mkdtemp(path.join(tmpdir(), "pi-footer-collaborator-"));

    try {
        await runGit(worktree, ["init"]);
        await runGit(worktree, ["config", "user.email", "footer@example.test"]);
        await runGit(worktree, ["config", "user.name", "Pi Footer"]);
        await writeFile(path.join(worktree, "README.md"), "initial\n", "utf8");
        await runGit(worktree, ["add", "README.md"]);
        await runGit(worktree, ["commit", "-m", "initial"]);
        await runGit(remote, ["init", "--bare"]);
        await runGit(worktree, ["remote", "add", "origin", remote]);
        await runGit(worktree, ["push", "--set-upstream", "origin", "HEAD"]);
        const branch = (await getGitOutput(worktree, ["branch", "--show-current"])).trim();
        await runGit(remote, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);

        await runGit(collaborator, ["clone", remote, "."]);
        await runGit(collaborator, ["config", "user.email", "collaborator@example.test"]);
        await runGit(collaborator, ["config", "user.name", "Collaborator"]);
        await writeFile(path.join(collaborator, "README.md"), "remote\n", "utf8");
        await runGit(collaborator, ["commit", "-am", "remote commit"]);
        await runGit(collaborator, ["push"]);
        await runGit(worktree, ["fetch", "origin"]);

        await writeFile(path.join(worktree, "README.md"), "first\n", "utf8");
        await runGit(worktree, ["commit", "-am", "first local commit"]);
        await writeFile(path.join(worktree, "README.md"), "second\n", "utf8");
        await runGit(worktree, ["commit", "-am", "second local commit"]);

        let resolveRender: (() => void) | undefined;
        const rendered = new Promise<void>((resolve) => {
            resolveRender = resolve;
        });
        const tracker = createGitAheadBehindTracker(
            worktree,
            () => {
                resolveRender?.();
            },
            { refreshIntervalMs: 0 },
        );

        await rendered;
        assert.deepEqual(tracker.getGitAheadBehind(), { ahead: 2, behind: 1 });
        tracker.dispose();
    } finally {
        await rm(worktree, { recursive: true, force: true });
        await rm(remote, { recursive: true, force: true });
        await rm(collaborator, { recursive: true, force: true });
    }
});

test("createGitAheadBehindTracker renders when its query returns a new status", async () => {
    let resolveQueryStarted: (() => void) | undefined;
    const queryStarted = new Promise<void>((resolve) => {
        resolveQueryStarted = resolve;
    });
    let resolveQuery: ((status: { ahead: number; behind: number } | undefined) => void) | undefined;
    let renderRequests = 0;
    const tracker = createGitAheadBehindTracker(
        "/workspace/pi-tweaks",
        () => {
            renderRequests += 1;
        },
        {
            refreshIntervalMs: 0,
            query() {
                if (resolveQueryStarted === undefined) {
                    throw new Error("Git ahead/behind query started more than once.");
                }
                resolveQueryStarted();
                resolveQueryStarted = undefined;
                return new Promise((resolve) => {
                    resolveQuery = resolve;
                });
            },
        },
    );

    await queryStarted;
    if (resolveQuery === undefined) {
        throw new Error("Git ahead/behind query did not provide a resolver.");
    }
    resolveQuery({ ahead: 2, behind: 1 });
    await waitForMicrotask();

    assert.deepEqual(tracker.getGitAheadBehind(), { ahead: 2, behind: 1 });
    assert.equal(renderRequests, 1);

    tracker.dispose();
});

test("createGitAheadBehindTracker aborts its active query on disposal", async () => {
    let abortObserved = false;
    let resolveQueryStarted: (() => void) | undefined;
    const queryStarted = new Promise<void>((resolve) => {
        resolveQueryStarted = resolve;
    });
    const tracker = createGitAheadBehindTracker("/workspace/pi-tweaks", () => undefined, {
        refreshIntervalMs: 0,
        query(_cwd, { signal }) {
            if (resolveQueryStarted === undefined) {
                throw new Error("Git ahead/behind query started more than once.");
            }
            resolveQueryStarted();
            resolveQueryStarted = undefined;
            return new Promise((resolve) => {
                signal.addEventListener(
                    "abort",
                    () => {
                        abortObserved = true;
                        resolve(undefined);
                    },
                    { once: true },
                );
            });
        },
    });

    await queryStarted;
    tracker.dispose();

    assert.equal(abortObserved, true);
});
