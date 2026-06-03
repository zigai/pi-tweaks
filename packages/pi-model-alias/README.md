# Pi Model Alias

Pi extension for configuring model aliases.

## Install

```sh
pi install @zigai/pi-model-alias
```

## Configuration

Create `~/.pi/agent/model-aliases.json`:

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

Each alias copies the original model configuration, shows the alias in model lists, resolves lookups for the alias, and rewrites provider request payloads back to the original model id.
