# Pi Model Modes

<a href="https://www.npmjs.com/package/@zigai/pi-model-modes"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-model-modes.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-model-modes"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-model-modes.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-model-modes.svg" style="display:inline-block;border:0" /></a>

Mode presets for switching models and thinking levels in Pi.

## Install

```sh
pi install npm:@zigai/pi-model-modes
```

## Features

- Adds `/mode` for selecting and configuring prompt modes.
- Adds `Ctrl+Shift+M` to select a mode.
- Adds `Ctrl+Space` to cycle modes.
- Can show the current mode in the prompt editor border when enabled.
- Colors the prompt editor border from the active mode, with an opt-in setting for thinking-derived border colors.

Modes can store a provider, model, thinking level, and optional color.

## Configuration

Configure global settings at `~/.pi/agent/pi-model-modes/config.json`.

| Option                        | Type      | Default     | Description                                                                |
| ----------------------------- | --------- | ----------- | -------------------------------------------------------------------------- |
| `version`                     | `number`  | `1`         | Config format version.                                                     |
| `currentMode`                 | `string`  | `"default"` | Mode selected at startup.                                                  |
| `modeShowName`                | `boolean` | `false`     | Shows the current mode name in the prompt editor border.                   |
| `modeUseThinkingBorderColors` | `boolean` | `false`     | Uses thinking-derived border colors when a mode has no explicit color.     |
| `modeShowThinkingLevelStatus` | `boolean` | `false`     | Shows Pi's transient thinking-level status message.                        |
| `modes`                       | `object`  | `{}`        | Named modes with optional `provider`, `modelId`, `thinkingLevel`, `color`. |

```json
{
  "$schema": "./config.schema.json",
  "version": 1,
  "currentMode": "default",
  "modeShowName": false,
  "modeUseThinkingBorderColors": false,
  "modeShowThinkingLevelStatus": false,
  "modes": {}
}
```

## License

MIT
