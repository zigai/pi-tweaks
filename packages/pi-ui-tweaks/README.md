# Pi UI Tweaks

[![npm version](https://img.shields.io/npm/v/@zigai/pi-ui-tweaks.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-ui-tweaks)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-ui-tweaks.svg)](https://www.npmjs.com/package/@zigai/pi-ui-tweaks)
[![license](https://img.shields.io/npm/l/@zigai/pi-ui-tweaks.svg)](../../LICENSE)

This Pi extension collects small configurable UI tweaks that are too tiny to deserve standalone packages.

## Tweaks

- `hideModelProviderHint` hides Pi's built-in `Only showing models from configured providers. Use /login to add providers.` model picker hint.
- `hideSlashCommandSourceTags` hides source tags like `[u:npm:@plannotator/pi-extension]` from slash command autocomplete descriptions.

## Settings

Configure in `~/.pi/agent/settings.json` or trusted project `.pi/settings.json`:

```json
{
  "uiTweaks": {
    "hideModelProviderHint": true,
    "hideSlashCommandSourceTags": true
  }
}
```

Defaults:

```json
{
  "uiTweaks": {
    "enabled": true,
    "hideModelProviderHint": true,
    "hideSlashCommandSourceTags": true
  }
}
```

Set `uiTweaks.enabled` to `false` to disable every tweak in this package.

## Install

```sh
pi install npm:@zigai/pi-ui-tweaks
```

Or install the full tweak bundle:

```sh
pi install git:github.com/zigai/pi-tweaks
```

## License

MIT
