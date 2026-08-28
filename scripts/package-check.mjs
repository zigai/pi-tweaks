import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = readFileSync(path.join(packageRoot, "dist", "src", "index.ts"), "utf8");
assert.equal(output.includes(packageRoot), false, "bundle must not contain workspace paths");

for (const requiredExternal of [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "@zigai/pi-extension-settings/pi",
    "@zigai/pi-extension-settings/runtime",
]) {
    assert.equal(
        output.includes(`from "${requiredExternal}"`),
        true,
        `bundle must retain ${requiredExternal} as an external`,
    );
}
assert.equal(
    /(?:from|import\()\s*["']@zigai\/pi-extension-internals(?:\/[^"']*)?["']/u.test(output),
    false,
    "aggregate bundle must inline one deduplicated internals runtime",
);
for (const forbidden of [
    "node_modules/@earendil-works/pi-coding-agent",
    "node_modules/@earendil-works/pi-tui",
    "node_modules/typebox",
]) {
    assert.equal(output.includes(forbidden), false, `bundle must externalize ${forbidden}`);
}

const extensionPackages = [
    "pi-model-filter",
    "pi-ui-tweaks",
    "pi-model-alias",
    "pi-tree",
    "pi-footer",
    "pi-response-renderer",
    "pi-plain-user-messages",
    "pi-message-highlights",
    "pi-status-bar",
    "pi-keymap-tweaks",
    "pi-model-modes",
    "pi-prompt-history",
    "pi-mention-skill",
    "pi-mention-project",
    "pi-trust-all-folders",
];
let previousIndex = -1;
for (const name of extensionPackages) {
    const index = output.indexOf(`name: "${name}"`, previousIndex + 1);
    assert.notEqual(index, -1, `bundle must retain ${name}`);
    assert.ok(index > previousIndex, `bundle must retain factory order at ${name}`);
    previousIndex = index;
}

const schemaPackages = [
    "pi-footer",
    "pi-mention-project",
    "pi-mention-skill",
    "pi-message-highlights",
    "pi-model-alias",
    "pi-model-filter",
    "pi-model-modes",
    "pi-status-bar",
    "pi-tree",
    "pi-ui-tweaks",
];
for (const packageName of schemaPackages) {
    const sourceSchema = readFileSync(
        path.join(packageRoot, "packages", packageName, "config.schema.json"),
        "utf8",
    );
    const packagedSchema = readFileSync(
        path.join(packageRoot, "dist", "config-schemas", `${packageName}.json`),
        "utf8",
    );
    assert.equal(packagedSchema, sourceSchema, `${packageName} schema must be copied exactly`);
    assert.equal(
        output.includes(`../config-schemas/${packageName}.json`),
        true,
        `${packageName} runtime must resolve its packaged schema`,
    );
}

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

    const workspacePackages = ["pi-extension-internals", ...extensionPackages];
    const tarballs = workspacePackages.map((packageName) =>
        pack(path.join(packageRoot, "packages", packageName), tarballDirectory),
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

    const installedScope = path.join(installRoot, "node_modules", "@zigai");
    assert.equal(
        existsSync(path.join(installRoot, "node_modules", "@earendil-works")),
        false,
        "managed-install check must not install Pi host peers",
    );

    const extensionEntries = extensionPackages.map((packageName) => {
        const entry = path.join(installedScope, packageName, "src", "index.ts");
        assert.ok(existsSync(entry), `${packageName} must contain its extension entry`);
        return entry;
    });
    for (const packageName of schemaPackages) {
        const installedPackage = path.join(installedScope, packageName);
        for (const relativePath of [
            "config.schema.json",
            "README.md",
            "src/settings-input.ts",
            "src/settings.prevalidated.ts",
        ]) {
            assert.ok(
                existsSync(path.join(installedPackage, relativePath)),
                `${packageName} must contain ${relativePath}`,
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

    const piCli = path.join(
        packageRoot,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "dist",
        "cli.js",
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
