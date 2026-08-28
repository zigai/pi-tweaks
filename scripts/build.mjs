import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(packageRoot, "packages");
const outputRoot = path.join(packageRoot, "dist");
const outfile = path.join(outputRoot, "src", "index.ts");
const schemaOutputRoot = path.join(outputRoot, "config-schemas");
const external = [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-agent-core/*",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-ai/*",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-coding-agent/*",
    "@earendil-works/pi-tui",
    "@earendil-works/pi-tui/*",
    "@mariozechner/*",
    "@zigai/pi-extension-settings",
    "@zigai/pi-extension-settings/*",
    "@sinclair/typebox",
    "@sinclair/typebox/*",
    "typebox",
    "typebox/*",
];

/** @type {string[]} */
const schemaPackages = [];
for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const schemaPath = path.join(packagesRoot, entry.name, "config.schema.json");
    try {
        await readFile(schemaPath, "utf8");
        schemaPackages.push(entry.name);
    } catch {
        // Packages without settings do not own a schema asset.
    }
}
schemaPackages.sort();

/** @type {esbuild.Plugin} */
const schemaUrlPlugin = {
    name: "pi-tweaks-config-schema-urls",
    setup(build) {
        build.onLoad({ filter: /\.ts$/ }, async (args) => {
            if (!args.path.startsWith(`${packagesRoot}${path.sep}`)) return undefined;
            const relative = path.relative(packagesRoot, args.path);
            const packageName = relative.split(path.sep)[0];
            if (packageName === undefined || !schemaPackages.includes(packageName))
                return undefined;
            const contents = (await readFile(args.path, "utf8")).replaceAll(
                'new URL("../config.schema.json", import.meta.url)',
                `new URL("../config-schemas/${packageName}.json", import.meta.url)`,
            );
            return { contents, loader: "ts" };
        });
    },
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.dirname(outfile), { recursive: true });
await mkdir(schemaOutputRoot, { recursive: true });
const result = await esbuild.build({
    absWorkingDir: packageRoot,
    entryPoints: ["src/index.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    treeShaking: true,
    sourcemap: true,
    sourcesContent: true,
    legalComments: "none",
    external,
    plugins: [schemaUrlPlugin],
    metafile: true,
});
for (const packageName of schemaPackages) {
    await copyFile(
        path.join(packagesRoot, packageName, "config.schema.json"),
        path.join(schemaOutputRoot, `${packageName}.json`),
    );
}

const bundledHostInputs = Object.keys(result.metafile.inputs).filter((input) =>
    /node_modules\/(?:@earendil-works|@mariozechner|@sinclair\/typebox|typebox)\//u.test(input),
);
if (bundledHostInputs.length > 0) {
    throw new Error(`Host identity modules entered the bundle: ${bundledHostInputs.join(", ")}`);
}
const output = await readFile(outfile, "utf8");
if (output.includes(packageRoot)) throw new Error("Bundle contains an absolute workspace path");
