# AGENTS.md

Guidance for agents working in this repository.

## Project shape

- This is a TypeScript ESM npm workspaces monorepo for Pi extensions.
- Packages live under `packages/*` and expose TypeScript entrypoints through each package's `pi.extensions` manifest.
- Extensions run inside Pi with user-level permissions. Treat config parsing, filesystem writes, and monkey-patches of Pi internals as high-risk changes.

## Commands

Run `just setup` after cloning to install dependencies and Git hooks and verify the repository. Before handing off later changes, run:

```sh
npm run check
```

The check runs generated-settings validation, formatting, lint, strict TypeScript checks, the Vitest suite, and npm package verification in CI order. Keep pre-commit enabled; its first hook rejects stale schemas or generated README settings documentation.

## Style and code conventions

- TypeScript is strict (`tsconfig.json`) and ESM (`type: module`). Keep explicit `.ts` suffixes on local imports, matching existing files.
- Formatting is handled by `oxfmt`; do not hand-format large blocks.
- `oxlint` enforces no ternary expressions in TypeScript. Prefer clear `if`/`else` assignments.
- Avoid `any`, `@ts-ignore`, and unchecked prototype assumptions. Use narrow structural types for Pi internals.
- Existing commits use Conventional Commit subjects such as `fix(pi-tree): ...` and `feat(pi-mention-skill): ...`.

## Module organization

- Keep `src/index.ts` as the cohesive Pi-facing extension entrypoint, not a ceremonially thin dispatcher. It owns lifecycle registration, settings application, controller construction, patch installation, and resource disposal; a single narrow Pi adapter may live there when extracting it would create a one-to-one pass-through module. Split out domain rules, persistence, reusable rendering, and independently substantial or multi-target adapters.
- Keep package source roots flat while modules remain cohesive. Create a capability subdirectory only when that capability genuinely spans roughly three or more files; do not add one-file directories.
- Name modules for the boundary or capability they own, such as `model-registry-patch.ts`, `modes-store.ts`, or `right-message.ts`. Do not create generic `utils.ts`, `helpers.ts`, `types.ts`, or `constants.ts` dumping grounds; colocate narrow helpers, types, and constants with their owner.
- Use `@zigai/pi-extension-internals` only for cross-extension composition protocols and guarded Pi-internal loading. Keep its API narrow; it must not become a general utility package. Every consuming extension must declare it as a runtime dependency.
- Removable patch installers must return idempotent handles with explicit update and disposal behavior. Store each handle with the patch marker, retain the current policy in that module, and restore the predecessor safely when disposed.
- Split tests by feature ownership. Reserve `index.test.ts` for composition and lifecycle behavior rather than collecting unrelated feature tests.

## Package boundaries

- Every published package must define an explicit `exports` map. Export only `"."` by default and add named subpaths such as `"./api"` only for intentional consumer APIs.
- Never use broad `export *` barrels at a package boundary. Tests should import internal modules directly instead of widening the public API for test access.
- Cross-package runtime imports are allowed only through a published package export. Do not import another package's `src/` files in runtime code.

## Extension-specific guidance

- Pi packages are independently installable. Avoid adding cross-package runtime dependencies unless the target dependency is published and declared in the consuming package.
- Env vars are for secrets, CI/session overrides, or explicit config-path overrides, not ordinary persistent extension options.
- When reading Pi agent files, prefer `getAgentDir()` from `@earendil-works/pi-coding-agent` so `PI_CODING_AGENT_DIR` and Pi's own path resolution stay consistent.
- Prototype monkey-patches must be idempotent. Keep `Symbol.for(...)` patch markers and only set them after the required prototype methods/modules have been verified.
- Dynamic imports of Pi internal files should fail gracefully with a clear warning; a Pi minor release should not crash startup just because an internal component moved.
- Do not start Pi-internal TUI imports from an extension factory. When a patch is required throughout an active TUI session, initialize it once at `session_start`; do not defer required behavior to a later command or first-use hook solely to move startup work. Own one in-flight activation per session, reject stale completion after reset, and restore the patch on shutdown.
- Measure interactive startup at a deterministic presented-screen boundary in a real TUI session. RPC readiness is useful for non-UI regressions but is not evidence of perceived TUI startup speed.

## Pi Extension Settings

- Only extensions with meaningful user-configurable behavior need extension-owned settings. Do not put extension runtime options in Pi's core `settings.json`.
- Use `@zigai/pi-extension-settings` for extension-owned JSON settings. Configurable packages must declare the exact supported version as a normal runtime dependency, not a bundled dependency, and verify it in Pi's managed npm installation topology.
- Keep authoring and runtime concerns in a flat settings capability. `src/settings-input.ts` is the build-safe TypeBox source of truth; it must not import Pi registration code, the generated artifact, or feature initialization. `src/settings.prevalidated.ts` is generated. `src/settings.ts` hydrates that artifact with `definePrevalidatedExtensionSettings` and owns the Pi-facing loader plus substantial extension-specific semantic validation.
- Use “settings” for the capability and source modules; reserve “config” for concrete persisted-file concepts such as config paths and `config.schema.json`. Do not create a one-file `src/config/` directory or generic settings helper modules.
- Derive resolved settings from the schema with `StaticDecode`; do not duplicate the decoded interface or cast serialized input. Parse other persisted boundaries from `unknown`, validate or decode once, then pass typed values inward.
- Register `src/settings-input.ts`, `src/settings.prevalidated.ts`, `config.schema.json`, and the README in the package's `piExtensionSettings` manifest. Ensure the package's `files` allowlist includes all four artifacts, either directly or through a containing directory or pattern.
- Expose the package-facing loader as `load<ExtensionName>Settings`, such as `loadMentionSkillSettings`. Ordinary extension code calls that loader rather than the definition or shared adapter directly.
- Loading is synchronous filesystem work. Keep it out of module import and extension factories. By default, treat `session_start` as the reset boundary and load once in the first callback that needs settings; when enabled behavior must begin during `session_start`, load there. The consuming extension owns caching, the activation sentinel, diagnostic presentation, disabled behavior, stale-result rejection, reset, and disposal. Document deliberate live-reload exceptions such as mtime-based model configuration.
- Resolution applies schema defaults, then global settings, then trusted-project settings. Objects merge recursively; arrays and scalar values replace earlier values.
- Never hardcode Pi configuration paths. Global settings and schemas resolve through Pi's agent directory; project overrides resolve through `CONFIG_DIR_NAME` and are honored only when `ctx.isProjectTrusted()` is true.
- Loading may scaffold a missing global settings file and install or refresh its editor schema. It never overwrites or repairs an existing settings file and never creates a project settings file. Malformed or invalid layers remain untouched and produce diagnostics that must not expose settings values or secrets.
- Use `updatePiExtensionSettings()` for explicit settings writes instead of adding ad hoc readers, locks, or atomic writers. Call the loader first. Project updates require trust and may create a missing project file; snapshot-based editors pass the loaded revision as `expectedRevision`, while semantic updates omit it. Handle every typed outcome, and do not add another mutation queue around the settings transaction.
- Run `just config-generate` after changing a definition. Run `just config-check` to prove checked-in prevalidation, schemas, and README regions are current; this check is required by pre-commit and `npm run check`.

## README Configuration Docs

- README config docs are generated between `<!-- pi-extension-settings:start -->` and `<!-- pi-extension-settings:end -->`. Do not hand-edit that region.
- Only packages with meaningful user-facing settings should declare `piExtensionSettings` and include a generated region.
- Generated docs contain the centralized global path, a compact option table, and the full scaffolded default JSON document.
- Setting descriptions belong on the TypeBox definition properties; wording changes flow into the README via `just config-generate`.
- `exampleSettings` is optional. Define it only when complex settings—such as structured arrays, nested objects, maps, unions, or meaningful interactions between options—need a realistic advanced example. Omit it for simple or self-explanatory settings. Keep examples valid, focused, and free of secrets and maintainer-specific paths.
- Give complex array-item and record-value object schemas a concise PascalCase `title`, such as `ModelMode`, so generated tables show a named type instead of an oversized structural declaration.
- Keep implementation lifecycle, project override, trust, and malformed-file behavior in `AGENTS.md`, source, tests, or dedicated advanced docs rather than generated user-facing configuration sections.

## Packaging notes

- Package manifests include `files` allowlists. If a README references an asset that must be present in the npm tarball, verify with `npm pack --dry-run -w <workspace>` before changing the manifest.
- Put extension-owned runtime libraries in `dependencies` and Pi-provided host APIs in `peerDependencies`. Verify packages in Pi's managed-install topology, where host peers are intentionally absent from the extension's `node_modules` tree.
- Keep README install snippets and the root package table in sync when adding/removing packages.
