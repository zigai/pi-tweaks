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

The check runs generated-settings validation, formatting, lint, strict TypeScript checks, and the Vitest suite in CI order. Keep pre-commit enabled; its first hook rejects stale schemas or generated README settings documentation.

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
- Use `@zigai/pi-extension-internals` only for cross-extension composition protocols and guarded Pi-internal loading. Keep its API narrow; it must not become a general utility package. Every consuming extension must declare and bundle it as a runtime dependency.
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

## Pi Extension Config

- Only extensions that need user-configurable behavior need extension-owned config. Do not put extension runtime options in Pi's core `settings.json`.
- Use `@zigai/pi-extension-settings` for extension-owned JSON config. Configurable packages must declare it as a runtime dependency and bundle it in their npm package.
- Keep each extension's TypeBox source of truth and runtime settings boundary together in a flat `src/settings.ts` module using `defineExtensionSettings`. Defaults, descriptions, validation constraints, the checked-in schema, runtime decoding, and README docs derive from that module.
- Use “settings” for the extension capability and source module; reserve “config” for concrete persisted-file concepts such as config paths and `config.schema.json`. Do not create a one-file `src/config/` directory or a parallel `config.ts`; split `settings.ts` only when a substantial domain capability earns its own specifically named module.
- Register each definition, `config.schema.json`, and README in the package's `piExtensionSettings` manifest field.
- Expose the package-facing loader as `load<ExtensionName>Settings`, such as `loadMentionSkillSettings`. This function owns the shared loader call and returns the extension's typed, resolved settings; ordinary extension code should call it rather than the definition or shared adapter directly.
- Implement that loader with `loadPiExtensionSettings`. The Pi adapter uses `getAgentDir()` and `CONFIG_DIR_NAME` from `@earendil-works/pi-coding-agent`; never hardcode `~/.pi/agent` or `.pi` in runtime code.
- Global config lives at `getAgentDir()/extension-settings/<extension-id>.json`; editor schemas live at `getAgentDir()/extension-settings/schemas/<extension-id>.schema.json`.
- Trusted project overrides live at `ctx.cwd/CONFIG_DIR_NAME/extension-settings/<extension-id>.json`. Never read project config for an untrusted project or create project config automatically.
- Parse config at the boundary: `JSON.parse` to `unknown`, validate/decode with TypeBox, then pass typed config inward. Do not cast `JSON.parse` output to config types or scatter hand-written shape checks.
- The shared loader scaffolds default global config only when missing, never overwrites existing or malformed config, and installs stale or missing schemas atomically.
- Run `just config-generate` after changing a definition. Run `just config-check` to prove checked-in schemas and README regions are current; this check is required by pre-commit and `npm run check`.

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
- Packages with bundled runtime dependencies must list them in both `dependencies` and `bundleDependencies` and run `scripts/prepare-bundled-dependencies.ts` from `prepack`; verify each bundled dependency and its runtime files appear in the packed tarball.
- Keep README install snippets and the root package table in sync when adding/removing packages.
