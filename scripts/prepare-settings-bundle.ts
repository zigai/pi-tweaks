import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const PackageManifestSchema = Type.Object(
    {
        name: Type.String(),
        version: Type.String(),
        dependencies: Type.Record(Type.String(), Type.String()),
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

const workspaceDir = process.cwd();
const rootDir = resolve(workspaceDir, "../..");
const packageName = "@zigai/pi-extension-settings";
const sourceDir = join(rootDir, "node_modules", "@zigai", "pi-extension-settings");
const targetDir = join(workspaceDir, "node_modules", "@zigai", "pi-extension-settings");

const workspaceManifest = readPackageManifest(join(workspaceDir, "package.json"));
const sourceManifest = readPackageManifest(join(sourceDir, "package.json"));
const expectedVersion = workspaceManifest.dependencies[packageName];
if (expectedVersion !== sourceManifest.version) {
    const expectedVersionLabel = expectedVersion ?? "an undeclared version";
    throw new Error(
        `${workspaceManifest.name} expects ${packageName}@${expectedVersionLabel}, ` +
            `but the installed bundle is ${sourceManifest.version}`,
    );
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
