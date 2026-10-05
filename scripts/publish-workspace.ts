import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { loadWorkspacePackages } from "./workspace-packages.ts";

const releaseManifest = Type.Object({
    name: Type.String(),
    version: Type.String(),
    private: Type.Optional(Type.Boolean()),
    dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
    optionalDependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export type ReleasePackage = Static<typeof releaseManifest>;

export type PublishServices = {
    isPublished: (workspace: ReleasePackage) => Promise<boolean>;
    publish: (workspace: ReleasePackage) => Promise<void>;
};

// Workspace dependencies currently use exact versions. Refuse other local specs
// rather than silently publishing a version that might not satisfy a consumer.
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function planWorkspacePublish(
    packages: readonly ReleasePackage[],
    selected: string,
): ReleasePackage[] {
    const byName = new Map(packages.map((workspace) => [workspace.name, workspace]));
    const active = new Set<string>();
    const visited = new Set<string>();
    const ordered: ReleasePackage[] = [];
    const target = byName.get(selected);
    if (target === undefined) throw new Error(`Unknown workspace package: ${selected}`);

    function visit(workspace: ReleasePackage): void {
        if (active.has(workspace.name)) {
            throw new Error(
                `Workspace dependency cycle: ${[...active, workspace.name].join(" -> ")}`,
            );
        }

        if (visited.has(workspace.name)) return;
        if (workspace.private === true)
            throw new Error(`Cannot publish private workspace ${workspace.name}`);

        if (!exactVersion.test(workspace.version)) {
            throw new Error(`Invalid workspace version: ${workspace.name}@${workspace.version}`);
        }

        active.add(workspace.name);

        const dependencies = { ...workspace.dependencies, ...workspace.optionalDependencies };
        for (const [name, spec] of Object.entries(dependencies)) {
            const dependency = byName.get(name);
            if (dependency === undefined) continue;

            if (!exactVersion.test(spec)) {
                throw new Error(
                    `Expected exact workspace dependency: ${workspace.name} -> ${name}@${spec}`,
                );
            }

            // Deliberately pinned historical versions must come from npm.
            if (dependency.version === spec) visit(dependency);
        }

        active.delete(workspace.name);
        visited.add(workspace.name);
        ordered.push(workspace);
    }

    visit(target);

    return ordered;
}

export async function publishWorkspace(
    packages: readonly ReleasePackage[],
    selected: string,
    services: PublishServices,
    wait: (milliseconds: number) => Promise<void> = setTimeout,
): Promise<void> {
    // Validate the complete graph before performing any registry writes.
    for (const workspace of planWorkspacePublish(packages, selected)) {
        if (await services.isPublished(workspace)) continue;
        try {
            await services.publish(workspace);
        } catch (error) {
            // Concurrent publication may be staged before npm exposes the version.
            // Only the exact version becoming visible confirms another job succeeded.
            let published = await services.isPublished(workspace);
            for (let attempt = 0; !published && attempt < 20; attempt++) {
                await wait(15_000);
                published = await services.isPublished(workspace);
            }

            if (!published) throw error;
        }
    }
}

export async function isPublishedOnNpm(
    workspace: ReleasePackage,
    request: typeof fetch = fetch,
): Promise<boolean> {
    const url = `https://registry.npmjs.org/${encodeURIComponent(workspace.name)}/${encodeURIComponent(workspace.version)}`;
    const response = await request(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
    });
    if (response.status === 404) return false;

    if (!response.ok) {
        throw new Error(
            `Registry lookup failed for ${workspace.name}@${workspace.version}: HTTP ${response.status}`,
        );
    }

    const value: unknown = await response.json();
    const identity = Type.Object({
        name: Type.Literal(workspace.name),
        version: Type.Literal(workspace.version),
    });
    if (!Value.Check(identity, value)) {
        throw new Error(`Unexpected registry response for ${workspace.name}@${workspace.version}`);
    }

    return true;
}

export function loadReleasePackages(root: string): ReleasePackage[] {
    return loadWorkspacePackages(root).packages.map(({ directory }) => {
        const file = path.join(directory, "package.json");
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!Value.Check(releaseManifest, value))
            throw new Error(`Invalid release manifest: ${file}`);

        return Value.Parse(releaseManifest, value);
    });
}

const entry = process.argv.at(1);
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
    const selected = process.argv.at(2);
    if (selected === undefined)
        throw new Error("Usage: node scripts/publish-workspace.ts <package-name>");

    const root = process.cwd();

    await publishWorkspace(loadReleasePackages(root), selected, {
        isPublished: isPublishedOnNpm,
        publish: async (workspace) => {
            console.log(`Publishing ${workspace.name}@${workspace.version}`);
            execFileSync(
                "npm",
                [
                    "publish",
                    "-w",
                    workspace.name,
                    "--access",
                    "public",
                    "--provenance",
                    "--registry",
                    "https://registry.npmjs.org",
                ],
                {
                    cwd: root,
                    stdio: "inherit",
                },
            );
        },
    });
}
