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
- Implement that loader with `loadPiExtensionSettings` or `loadPiExtensionSettingsSync`. The Pi adapter uses `getAgentDir()` and `CONFIG_DIR_NAME` from `@earendil-works/pi-coding-agent`; never hardcode `~/.pi/agent` or `.pi` in runtime code.
- Global config lives at `getAgentDir()/extension-settings/<extension-id>.json`; editor schemas live at `getAgentDir()/extension-settings/schemas/<extension-id>.schema.json`.
- Trusted project overrides live at `ctx.cwd/CONFIG_DIR_NAME/extension-settings/<extension-id>.json`. Never read project config for an untrusted project or create project config automatically.
- Parse config at the boundary: `JSON.parse` to `unknown`, validate/decode with TypeBox, then pass typed config inward. Do not cast `JSON.parse` output to config types or scatter hand-written shape checks.
- The shared loader scaffolds default global config only when missing, never overwrites existing or malformed config, installs stale/missing schemas atomically, and non-destructively migrates the former per-extension directory layout.
- Run `just config-generate` after changing a definition. Run `just config-check` to prove checked-in schemas and README regions are current; this check is required by pre-commit and `npm run check`.

## README Configuration Docs

- README config docs are generated between `<!-- pi-extension-settings:start -->` and `<!-- pi-extension-settings:end -->`. Do not hand-edit that region.
- Only packages with meaningful user-facing settings should declare `piExtensionSettings` and include a generated region.
- Generated docs contain the centralized global path, a compact option table, and the full scaffolded default JSON document.
- Setting descriptions belong on the TypeBox definition properties; wording changes flow into the README via `just config-generate`.
- Keep implementation lifecycle, project override, migration, trust, and malformed-file behavior in `AGENTS.md`, source, tests, or dedicated advanced docs rather than generated user-facing configuration sections.

## Packaging notes

- Package manifests include `files` allowlists. If a README references an asset that must be present in the npm tarball, verify with `npm pack --dry-run -w <workspace>` before changing the manifest.
- Configurable packages must keep the shared settings dependency in `bundleDependencies` and run `scripts/prepare-settings-bundle.ts` from `prepack`; verify the packed file list contains both `@zigai/pi-extension-settings` and its bundled `better-result` runtime.
- Keep README install snippets and the root package table in sync when adding/removing packages.
