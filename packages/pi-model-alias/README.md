# Pi Model Alias

<a href="https://www.npmjs.com/package/@zigai/pi-model-alias"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-model-alias.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-model-alias"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-model-alias.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/master/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-model-alias.svg" style="display:inline-block;border:0" /></a>

Add aliases for long provider model IDs and provider display names.

Use it when a provider model identifier is hard to type or when provider IDs are hard to scan in Pi UI. Model aliases are shown and accepted by Pi, then rewritten back to the original model ID before provider requests are sent. Provider aliases are visual only; Pi still uses the real provider ID for auth, lookup, and requests.

## Install

```sh
pi install npm:@zigai/pi-model-alias
```

<!-- pi-extension-settings:start -->
## Configuration

Global settings are stored in `~/.pi/agent/extension-settings/pi-model-alias.json`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `aliases` | object[] | `[]` | Model alias entries matched by provider and model ID. |
| `providerAliases` | object[] | `[]` | Provider display-name aliases. |
| `stableProviderColumn` | boolean | `true` | Keep the provider column stable when aliases are displayed. |

```json
{
  "$schema": "./schemas/pi-model-alias.schema.json",
  "aliases": [],
  "providerAliases": [],
  "stableProviderColumn": true
}
```
<!-- pi-extension-settings:end -->

## License

MIT
