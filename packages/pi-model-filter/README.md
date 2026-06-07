# Pi Model Filter

This Pi extension filters visible models.

## Install

```sh
pi install git:github.com/zigai/pi-ux-tweaks
```

Example `~/.pi/agent/model-filters.json`:

```json
{
  "$schema": "./model-filters.schema.json",
  "include": [
    {
      "provider": "openai-codex",
      "models": ["gpt-5.3*", "gpt-5.4*", "gpt-5.5*"]
    }
  ],
  "exclude": [
    {
      "provider": "openrouter",
      "models": ["openai/gpt-oss-20b:free", "qwen/*", "*:free"]
    },
    {
      "provider": "*",
      "models": ["*-preview", "*-experimental"]
    }
  ]
}
```

## Rules

- `provider` and `models` match provider/model ids.
- Exact strings and glob patterns are supported.
- `*` matches any number of characters; `?` matches one character.
- `include` allowlists models for matching providers.
- `exclude` hides matching models and always wins over `include`.
- Providers without `include` rules stay visible unless excluded.

## Behavior

This extension filters models from Pi's model registry views, including:

- `/model`
- model cycling
- `modelRegistry.getAll()`
- `modelRegistry.getAvailable()`
- `modelRegistry.find()`

It does not delete provider definitions, model definitions, or credentials.
