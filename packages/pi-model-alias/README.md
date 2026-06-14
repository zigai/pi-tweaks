# Pi Model Alias

[![npm version](https://img.shields.io/npm/v/@zigai/pi-model-alias.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-model-alias)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-model-alias.svg)](https://www.npmjs.com/package/@zigai/pi-model-alias)
[![license](https://img.shields.io/npm/l/@zigai/pi-model-alias.svg)](../../LICENSE)

This Pi extension lets you give long provider model IDs short, friendly names in Pi.

Use it when a provider model identifier is hard to type or hard to scan in the model picker. Pi will show and accept your alias, but provider requests are rewritten back to the original model ID before they are sent.

## Install

```sh
pi install npm:@zigai/pi-model-alias
```

## Configuration

Create `~/.pi/agent/model-aliases.json` and add one object for each alias you want:

```json
{
  "$schema": "./model-aliases.schema.json",
  "aliases": [
    {
      "provider": "fireworks",
      "model": "accounts/fireworks/routers/kimi-k2p6-turbo",
      "alias": "kimi-k2.6-turbo",
      "name": "kimi-k2.6-turbo"
    }
  ]
}
```

Fields:

- `provider`: the Pi provider ID that owns the original model.
- `model`: the provider's real model ID.
- `alias`: the short model ID you want to type or select in Pi.
- `name`: the display name shown in model lists. This can match `alias`.

After configuration, the extension copies the original model configuration, adds the alias to Pi's model list, resolves lookups for the alias, and rewrites outgoing provider payloads back to the original `model` value.

## License

MIT
