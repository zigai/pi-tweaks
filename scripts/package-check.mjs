import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadWorkspacePackages } from "./workspace-packages.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaces = loadWorkspacePackages(packageRoot);

/**
 * @param {string} cwd
 * @param {string} destination
 * @returns {string}
 */
function pack(cwd, destination) {
    const result = execFileSync(
        "npm",
        ["pack", "--silent", "--ignore-scripts", "--pack-destination", destination],
        {
            cwd,
            encoding: "utf8",
        },
    );
    const filename = result.trim().split(/\r?\n/u).at(-1);
    if (filename === undefined || filename.length === 0) {
        throw new Error(`npm pack did not report a tarball for ${cwd}`);
    }

    return path.join(destination, filename);
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pi-tweaks-package-check-"));

try {
    const tarballDirectory = path.join(temporaryRoot, "tarballs");
    const installRoot = path.join(temporaryRoot, "install");
    const agentDirectory = path.join(temporaryRoot, "agent");
    const sessionDirectory = path.join(temporaryRoot, "sessions");
    const projectDirectory = path.join(temporaryRoot, "project");

    for (const directory of [
        tarballDirectory,
        installRoot,
        agentDirectory,
        sessionDirectory,
        projectDirectory,
    ]) {
        mkdirSync(directory, { recursive: true });
    }

    const tarballs = workspaces.packages.map((workspace) =>
        pack(workspace.directory, tarballDirectory),
    );
    tarballs.push(
        pack(
            path.join(packageRoot, "node_modules", "@zigai", "pi-extension-settings"),
            tarballDirectory,
        ),
    );

    execFileSync(
        "npm",
        [
            "install",
            ...tarballs,
            "--prefix",
            installRoot,
            "--legacy-peer-deps",
            "--prefer-offline",
            "--package-lock=false",
        ],
        { cwd: packageRoot, encoding: "utf8", stdio: "pipe" },
    );

    const installedModules = path.join(installRoot, "node_modules");
    assert.equal(
        existsSync(path.join(installedModules, "@earendil-works")),
        false,
        "managed-install check must not install Pi host peers",
    );

    const internalsDirectory = path.join(installedModules, "@zigai", "pi-extension-internals");
    const internalsEntry = path.join(internalsDirectory, "dist", "index.js");
    assert.ok(existsSync(internalsEntry), "shared internals must publish JavaScript");
    assert.ok(
        existsSync(path.join(internalsDirectory, "dist", "index.d.ts")),
        "shared internals must publish TypeScript declarations",
    );
    assert.equal(
        existsSync(path.join(internalsDirectory, "src", "index.ts")),
        false,
        "shared internals must not require raw TypeScript at runtime",
    );

    execFileSync(
        process.execPath,
        [
            "--input-type=module",
            "--eval",
            `import { installLinkedMethodPatch, registerEditorEnhancer } from "@zigai/pi-extension-internals";
if (typeof installLinkedMethodPatch !== "function" || typeof registerEditorEnhancer !== "function") {
    throw new Error("shared internals could not be imported natively without Pi host peers");
}`,
        ],
        { cwd: installRoot, encoding: "utf8" },
    );

    const extensionEntries = workspaces.extensions.map(({ workspace, entry }) => {
        const installedEntry = path.join(installedModules, workspace.manifest.name, entry);
        assert.ok(
            existsSync(installedEntry),
            `${workspace.manifest.name} must contain its extension entry`,
        );
        return installedEntry;
    });

    for (const { manifest } of workspaces.packages) {
        if (manifest.piExtensionSettings === undefined) continue;

        const installedPackage = path.join(installedModules, manifest.name);
        for (const relativePath of Object.values(manifest.piExtensionSettings)) {
            assert.ok(
                existsSync(path.join(installedPackage, relativePath)),
                `${manifest.name} must contain ${relativePath}`,
            );
        }
    }

    writeFileSync(path.join(agentDirectory, "auth.json"), "{}\n");
    writeFileSync(path.join(agentDirectory, "models-store.json"), "{}\n");
    writeFileSync(
        path.join(agentDirectory, "settings.json"),
        `${JSON.stringify(
            {
                defaultProjectTrust: "always",
                extensions: extensionEntries,
                quietStartup: true,
            },
            undefined,
            2,
        )}\n`,
    );

    const piPackageDirectory = path.join(
        packageRoot,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
    );
    const piCli = path.join(piPackageDirectory, "dist", "bundle", "cli.js");
    const bundleUrl = pathToFileURL(path.join(piPackageDirectory, "dist/bundle/index.js")).href;
    const identityProbe = path.join(projectDirectory, "pi-public-identity-probe.ts");

    const publicClasses = [
        "TreeSelectorComponent",
        "AssistantMessageComponent",
        "UserMessageComponent",
        "InteractiveMode",
        "ModelSelectorComponent",
        "Theme",
    ];
    writeFileSync(
        identityProbe,
        `import * as pi from "@earendil-works/pi-coding-agent";
export default async function () {
    const host = globalThis[Symbol.for("zigai.pi-tweaks.package-check-host")];
    const deferred = await import("@earendil-works/pi-coding-agent");
    for (const name of ${JSON.stringify(publicClasses)}) {
        if (pi[name] !== host[name] || deferred[name] !== host[name]) {
            throw new Error(name + " is not the running Pi class");
        }
    }
}
`,
    );

    const loadProbe = `
        import * as host from ${JSON.stringify(bundleUrl)};
        globalThis[Symbol.for("zigai.pi-tweaks.package-check-host")] = host;
        const paths = [...JSON.parse(process.argv[1]), ${JSON.stringify(identityProbe)}];
        const result = await host.discoverAndLoadExtensions(paths, process.cwd(), process.env.PI_CODING_AGENT_DIR);
        if (result.errors.length > 0 || result.extensions.length !== paths.length) {
            console.error(JSON.stringify({ loaded: result.extensions.length, errors: result.errors }));
            process.exitCode = 1;
        }
    `;

    execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", loadProbe, JSON.stringify(extensionEntries)],
        {
            cwd: projectDirectory,
            encoding: "utf8",
            env: {
                ...process.env,
                PI_CODING_AGENT: "true",
                PI_PACKAGE_DIR: piPackageDirectory,
                PI_CODING_AGENT_DIR: agentDirectory,
                PI_OFFLINE: "1",
            },
        },
    );

    const loaded = spawnSync(
        process.execPath,
        [piCli, "--mode", "rpc", "--no-session", "--session-dir", sessionDirectory],
        {
            cwd: projectDirectory,
            encoding: "utf8",
            env: {
                ...process.env,
                NO_COLOR: "1",
                PI_CODING_AGENT_DIR: agentDirectory,
                PI_OFFLINE: "1",
                PI_SKIP_VERSION_CHECK: "1",
            },
            input: '{"type":"get_state"}\n',
            timeout: 120_000,
        },
    );

    assert.equal(loaded.error, undefined, loaded.error?.message);
    assert.equal(
        loaded.status,
        0,
        `packed extensions failed to load\nstdout:\n${loaded.stdout}\nstderr:\n${loaded.stderr}`,
    );
    assert.match(loaded.stdout, /"type":"response"/u, "Pi must answer the load probe");
    assert.doesNotMatch(
        loaded.stderr,
        /unavailable; Pi internals may have changed/u,
        `packed extension disabled a Pi-internal feature:\n${loaded.stderr}`,
    );
} finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("pi-tweaks package check passed");
