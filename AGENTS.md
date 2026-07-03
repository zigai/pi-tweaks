# AGENTS.md

Guidance for agents working in this repository.

## Project shape

- This is a TypeScript ESM npm workspaces monorepo for Pi extensions.
- Packages live under `packages/*` and expose TypeScript entrypoints through each package's `pi.extensions` manifest.
- Extensions run inside Pi with user-level permissions. Treat config parsing, filesystem writes, and monkey-patches of Pi internals as high-risk changes.

## Commands

Run these from the repo root before handing off code changes:

```sh
npm run format:check
npm run lint
npm run typecheck
```

`npm run check` runs the same three gates in CI order. There is currently no automated test suite; do not claim test coverage beyond the commands above unless you add and run targeted tests.

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
- Use JSON config only.
- Use extension-owned global config at the package’s concrete `getAgentDir()` path, such as `getAgentDir()/pi-mode/config.json`.
- Use trusted project overrides at the package’s concrete project path, such as `ctx.cwd/CONFIG_DIR_NAME/pi-mode/config.json`.
- Always use `getAgentDir()` and `CONFIG_DIR_NAME` from `@earendil-works/pi-coding-agent` instead of hardcoded `~/.pi/agent` or `.pi`.
- Parse config at the boundary: `JSON.parse` to `unknown`, validate/decode with TypeBox, then pass typed config inward. Do not cast `JSON.parse` output to config types or scatter hand-written shape checks.
- Keep a checked-in `config.schema.json` up to date with the TypeBox schema for every extension-owned config file.
- Extensions with config should safely scaffold default global config only when missing, or provide an explicit setup command. Never overwrite existing or malformed user config.
- Extensions with config should create `config.schema.json` when missing and refresh it from the bundled checked-in schema when stale.
- Project config should not be auto-created unless an explicit command already does that.

## README Configuration Docs

- README config docs are user-facing: explain settings and examples, not implementation lifecycle.
- Only include a Configuration or Settings section for packages with meaningful user-facing settings.
- Use this structure for package README config sections:
  1. One short sentence naming only the package’s concrete global path, such as `~/.pi/agent/pi-mode/config.json`.
  2. Compact option table: Option, Type, Default, Description. List actual user-editable setting keys, preferably dot paths like `tools.webSearch`; avoid vague category rows such as `tools`, `openai`, or `appearance` unless that object is edited as a single meaningful value.
  3. One JSON example showing the full scaffolded default config.
- README config JSON blocks must be the full default config. Do not omit settings just because their value is the default.
- Include `$schema` in JSON examples when it is part of the scaffolded default config, but do not explain `$schema` in prose.
- If an option has no scaffolded default, document it in the table but do not invent a default value in JSON.
- Do not mention trusted project overrides, project-specific config paths, TypeBox, `getAgentDir()`/`CONFIG_DIR_NAME` implementation names, schema refresh mechanics, user-owned/extension-owned terminology, or malformed-config overwrite policy in READMEs.
- Keep implementation lifecycle and project override details in `AGENTS.md`, source, tests, or dedicated advanced docs.

## Packaging notes

- Package manifests include `files` allowlists. If a README references an asset that must be present in the npm tarball, verify with `npm pack --dry-run -w <workspace>` before changing the manifest.
- Keep README install snippets and the root package table in sync when adding/removing packages.
