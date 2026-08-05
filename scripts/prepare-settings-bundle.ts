import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const PackageManifestSchema = Type.Object(
    {
        name: Type.String(),
        version: Type.String(),
        dependencies: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    { additionalProperties: true },
);
type PackageManifest = Static<typeof PackageManifestSchema>;

function readPackageManifest(filePath: string): PackageManifest {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Value.Check(PackageManifestSchema, parsed)) {
        throw new Error(`Invalid package manifest: ${filePath}`);
    }
    return parsed;
}

function dependencyDirectory(directory: string, packageName: string): string {
    return join(directory, "node_modules", ...packageName.split("/"));
}

function findInstalledPackage(rootDir: string, fromDir: string, packageName: string): string {
    let directory = fromDir;
    while (directory === rootDir || directory.startsWith(`${rootDir}${sep}`)) {
        const candidate = dependencyDirectory(directory, packageName);
        if (existsSync(join(candidate, "package.json"))) return candidate;

        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }
    throw new Error(`Could not resolve bundled runtime dependency ${packageName} from ${fromDir}`);
}

function stagePackageTree(
    rootDir: string,
    sourceDir: string,
    targetDir: string,
    ancestors: ReadonlySet<string> = new Set(),
): void {
    const manifest = readPackageManifest(join(sourceDir, "package.json"));
    const identity = `${manifest.name}@${manifest.version}`;
    if (ancestors.has(identity)) {
        throw new Error(`Circular bundled runtime dependency detected at ${identity}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(dirname(targetDir), { recursive: true });
    cpSync(sourceDir, targetDir, {
        recursive: true,
        dereference: true,
        filter: (sourcePath) => sourcePath === sourceDir || basename(sourcePath) !== "node_modules",
    });

    const nextAncestors = new Set(ancestors).add(identity);
    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
        const dependencySource = findInstalledPackage(rootDir, sourceDir, dependencyName);
        const dependencyTarget = dependencyDirectory(targetDir, dependencyName);
        stagePackageTree(rootDir, dependencySource, dependencyTarget, nextAncestors);
    }
}

const workspaceDir = process.cwd();
const rootDir = resolve(workspaceDir, "../..");
const packageName = "@zigai/pi-extension-settings";
const sourceDir = join(rootDir, "node_modules", "@zigai", "pi-extension-settings");
const targetDir = join(workspaceDir, "node_modules", "@zigai", "pi-extension-settings");

const workspaceManifest = readPackageManifest(join(workspaceDir, "package.json"));
const sourceManifest = readPackageManifest(join(sourceDir, "package.json"));
const expectedVersion = workspaceManifest.dependencies?.[packageName];
if (expectedVersion !== sourceManifest.version) {
    const expectedVersionLabel = expectedVersion ?? "an undeclared version";
    throw new Error(
        `${workspaceManifest.name} expects ${packageName}@${expectedVersionLabel}, ` +
            `but the installed bundle is ${sourceManifest.version}`,
    );
}

stagePackageTree(rootDir, sourceDir, targetDir);
