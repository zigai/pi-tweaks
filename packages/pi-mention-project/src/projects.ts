import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { MentionProjectSettings, ProjectDirectory } from "./types.ts";
import { compareProjectNames } from "./util.ts";

export type ProjectDirectorySource = {
    getCachedProjects(): ProjectDirectory[];
    getProjects(): Promise<ProjectDirectory[]>;
    refresh(): Promise<ProjectDirectory[]>;
};

function expandHome(root: string): string {
    if (root === "~") return os.homedir();
    if (root.startsWith("~/") || root.startsWith("~\\")) {
        return path.join(os.homedir(), root.slice(2));
    }
    return root;
}

export function resolveProjectRoot(root: string, cwd: string): string {
    const expanded = expandHome(root.trim());
    if (path.isAbsolute(expanded)) return path.resolve(expanded);
    return path.resolve(cwd, expanded);
}

function uniqueResolvedRoots(roots: string[], cwd: string): string[] {
    const seen = new Set<string>();
    const resolved: string[] = [];

    for (const root of roots) {
        const directory = resolveProjectRoot(root, cwd);
        if (seen.has(directory)) continue;
        seen.add(directory);
        resolved.push(directory);
    }

    return resolved;
}

async function directoryEntryIsDirectory(root: string, entry: Dirent): Promise<boolean> {
    if (entry.isDirectory()) return true;
    if (!entry.isSymbolicLink()) return false;

    try {
        const stats = await fs.stat(path.join(root, entry.name));
        return stats.isDirectory();
    } catch {
        return false;
    }
}

async function isGitRepository(projectPath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(path.join(projectPath, ".git"));
        return stats.isDirectory() || stats.isFile();
    } catch {
        return false;
    }
}

async function directoryEntryMatchesSettings(
    root: string,
    entry: Dirent,
    settings: MentionProjectSettings,
): Promise<boolean> {
    if (!settings.includeDotFolders && entry.name.startsWith(".")) return false;
    if (!(await directoryEntryIsDirectory(root, entry))) return false;
    if (!settings.gitReposOnly) return true;
    return isGitRepository(path.join(root, entry.name));
}

async function listRootProjectDirectories(
    root: string,
    settings: MentionProjectSettings,
): Promise<ProjectDirectory[]> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }

    const projects: ProjectDirectory[] = [];
    for (const entry of entries) {
        if (!(await directoryEntryMatchesSettings(root, entry, settings))) continue;
        const projectPath = path.join(root, entry.name);
        projects.push({ name: entry.name, path: projectPath, root });
    }

    projects.sort((left, right) => compareProjectNames(left.name, right.name));
    return projects;
}

export function uniqueProjectsByName(projects: ProjectDirectory[]): ProjectDirectory[] {
    const seen = new Set<string>();
    const unique: ProjectDirectory[] = [];

    for (const project of projects) {
        if (seen.has(project.name)) continue;
        seen.add(project.name);
        unique.push(project);
    }

    return unique;
}

export async function listProjectDirectories(
    settings: MentionProjectSettings,
    cwd: string,
): Promise<ProjectDirectory[]> {
    const projects: ProjectDirectory[] = [];
    for (const root of uniqueResolvedRoots(settings.roots, cwd)) {
        projects.push(...(await listRootProjectDirectories(root, settings)));
    }
    return uniqueProjectsByName(projects);
}

export function createProjectDirectorySource(
    settings: MentionProjectSettings,
    cwd: string,
): ProjectDirectorySource {
    let cachedProjects: ProjectDirectory[] = [];

    const refresh = async (): Promise<ProjectDirectory[]> => {
        cachedProjects = await listProjectDirectories(settings, cwd);
        return [...cachedProjects];
    };

    return {
        getCachedProjects() {
            return [...cachedProjects];
        },
        getProjects() {
            return refresh();
        },
        refresh,
    };
}
