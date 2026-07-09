# Pi Model Alias

<a href="https://www.npmjs.com/package/@zigai/pi-model-alias"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-model-alias.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-model-alias"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-model-alias.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-model-alias.svg" style="display:inline-block;border:0" /></a>

Add aliases for long provider model IDs and provider display names.

Use it when a provider model identifier is hard to type or when provider IDs are hard to scan in Pi UI. Model aliases are shown and accepted by Pi, then rewritten back to the original model ID before provider requests are sent. Provider aliases are visual only; Pi still uses the real provider ID for auth, lookup, and requests.

## Install

```sh
pi install npm:@zigai/pi-model-alias
```

## Configuration

Configure global settings at `~/.pi/agent/pi-model-alias/config.json`.

| Option                 | Type              | Default | Description                                                                                        |
| ---------------------- | ----------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `aliases`              | `ModelAlias[]`    | `[]`    | Model aliases to expose in Pi model selection and rewrite before provider requests.                |
| `providerAliases`      | `ProviderAlias[]` | `[]`    | Provider display names to show in Pi UI while preserving the real provider id.                     |
| `stableProviderColumn` | `boolean`         | `true`  | Align provider names using the longest filtered model name instead of only currently visible rows. |

```json
{
  "$schema": "./config.schema.json",
  "aliases": [],
  "providerAliases": [],
  "stableProviderColumn": true
}
```

## License

MIT
