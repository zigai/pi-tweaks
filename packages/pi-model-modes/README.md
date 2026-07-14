# Pi Model Modes

<a href="https://www.npmjs.com/package/@zigai/pi-model-modes"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-model-modes.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-model-modes"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-model-modes.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/master/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-model-modes.svg" style="display:inline-block;border:0" /></a>

Mode presets for switching models and thinking levels in Pi.

## Install

```sh
pi install npm:@zigai/pi-model-modes
```

## Features

- Adds `/mode` for selecting and configuring prompt modes.
- Adds `Ctrl+Shift+M` to select a mode.
- Supports optional forward and backward keyboard shortcuts for cycling modes.
- Colors the prompt editor border from the active mode, with an opt-in setting for thinking-derived border colors.
- Applies an optional persistent default model to fresh sessions without changing it when the session model changes.

Modes can store a provider, model, thinking level, and optional color. Their JSON object order is the exact cycle order; with configured modes, no implicit entries are added. Mode cycling matches the active provider and model, ignoring thinking level, and wraps from the last mode to the first and vice versa. No cycling shortcut is configured by default.

Set the persistent default through `/mode` → `Configure modes…` → `Set default model…`, or edit `defaultModel` in the configuration file.

<!-- pi-extension-settings:start -->
## Configuration

Global settings are stored in `~/.pi/agent/extension-settings/pi-model-modes.json`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | number | `1` | Settings format version. |
| `currentMode` | string | `"default"` | Currently selected mode ID. |
| `defaultModel.provider` | string | — | Default model provider. |
| `defaultModel.modelId` | string | — | Default model ID. |
| `defaultModel.thinkingLevel` | unknown | — | Optional default thinking level. |
| `modeUseThinkingBorderColors` | boolean | `false` | Use thinking-level colors instead of mode colors for borders. |
| `modeShowThinkingLevelStatus` | boolean | `false` | Show thinking level alongside mode status. |
| `shortcuts.forward` | string | — | Shortcut for cycling modes forward. |
| `shortcuts.backward` | string | — | Shortcut for cycling modes backward. |
| `modes` | object | `{}` | Named model-mode specifications keyed by mode ID. |

```json
{
  "$schema": "./schemas/pi-model-modes.schema.json",
  "version": 1,
  "currentMode": "default",
  "modeUseThinkingBorderColors": false,
  "modeShowThinkingLevelStatus": false,
  "modes": {}
}
```
<!-- pi-extension-settings:end -->

## License

MIT
