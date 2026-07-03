# Pi Mode

[![npm version](https://img.shields.io/npm/v/@zigai/pi-mode.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-mode)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-mode.svg)](https://www.npmjs.com/package/@zigai/pi-mode)
[![license](https://img.shields.io/npm/l/@zigai/pi-mode.svg)](../../LICENSE)

This Pi extension adds prompt modes for model and thinking-level switching.

## Install

```sh
pi install npm:@zigai/pi-mode
```

## Features

- Adds `/mode` for selecting and configuring prompt modes.
- Adds `Ctrl+Shift+M` to select a mode.
- Adds `Ctrl+Space` to cycle modes.
- Can show the current mode in the prompt editor border when enabled.
- Colors the prompt editor border from the active mode, with an opt-in setting for thinking-derived border colors.

Modes can store a provider, model, thinking level, and optional color. By default, Pi Mode hides Pi's transient `Thinking level: …` status message because the active thinking level is already visible in the footer.

## Configuration

Configure global settings at `~/.pi/agent/pi-mode/config.json`.

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
