# Pi Model Alias

[![npm version](https://img.shields.io/npm/v/@zigai/pi-model-alias.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-model-alias)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-model-alias.svg)](https://www.npmjs.com/package/@zigai/pi-model-alias)
[![license](https://img.shields.io/npm/l/@zigai/pi-model-alias.svg)](../../LICENSE)

Add aliases for long provider model IDs and provider display names.

Use it when a provider model identifier is hard to type or when provider IDs are hard to scan in Pi UI. Model aliases are shown and accepted by Pi, then rewritten back to the original model ID before provider requests are sent. Provider aliases are visual only; Pi still uses the real provider ID for auth, lookup, and requests.

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
  ],
  "providerAliases": [
    {
      "provider": "fireworks",
      "name": "Fireworks Work"
    }
  ]
}
```

Model alias fields:

- `provider`: the Pi provider ID that owns the original model.
- `model`: the provider's real model ID.
- `alias`: the short model ID you want to type or select in Pi.
- `name`: the display name shown in model lists. This can match `alias`.

Provider alias fields:

- `provider`: the real Pi provider ID.
- `name`: the visual provider name shown in provider selectors and model picker badges.

After configuration, the extension copies the original model configuration, adds model aliases to Pi's model list, resolves lookups for model aliases, rewrites outgoing provider payloads back to the original `model` value, and applies provider aliases only at display seams.

## License

MIT
