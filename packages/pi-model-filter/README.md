# Pi Model Filter

[![npm version](https://img.shields.io/npm/v/@zigai/pi-model-filter.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-model-filter)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-model-filter.svg)](https://www.npmjs.com/package/@zigai/pi-model-filter)
[![license](https://img.shields.io/npm/l/@zigai/pi-model-filter.svg)](../../LICENSE)

This Pi extension filters visible models.

## Install

```sh
pi install npm:@zigai/pi-model-filter
```

## Configuration

Configure global settings at `~/.pi/agent/pi-model-filter/config.json`.

| Option    | Type     | Default | Description                                                                                              |
| --------- | -------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `include` | `Rule[]` | `[]`    | Allowlist rules. When any include rule matches a provider, only matching models from that provider show. |
| `exclude` | `Rule[]` | `[]`    | Blocklist rules. Exclude rules apply after include rules, so exclude always wins.                        |

```json
{
  "$schema": "./config.schema.json",
  "include": [],
  "exclude": []
}
```

## Rules

- `provider` and `models` match provider/model ids.
- Exact strings and glob patterns are supported.
- `*` matches any number of characters; `?` matches one character.
- `include` allowlists models for matching providers.
- `exclude` hides matching models and always wins over `include`.
- Providers without `include` rules stay visible unless excluded.

## How is this different from `/scoped-models`?

Pi has a built-in `/scoped-models` command. It shows an interactive checklist that lets you enable or disable individual models for `Ctrl+P` cycling. Changes are session-only until you press `Ctrl+S` to persist them.

`pi-model-filter` works differently:

|                      | `/scoped-models`                     | `pi-model-filter`                                                     |
| -------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| How you configure it | Interactive checklist                | JSON config file with glob patterns                                   |
| What it affects      | `Ctrl+P` model cycling only          | `/model`, `Ctrl+L`, `Ctrl+P` cycling, and `modelRegistry.*()` lookups |
| Persistence          | Optional (save with `Ctrl+S`)        | Always loaded from JSON config                                        |
| Use case             | Quickly narrow the active cycle list | Permanently hide noisy/unwanted models everywhere                     |

## Behavior

This extension filters models from Pi's model registry views, including:

- `/model`
- model cycling
- `modelRegistry.getAll()`
- `modelRegistry.getAvailable()`
- `modelRegistry.find()`

It does not delete provider definitions, model definitions, or credentials.

## License

MIT
