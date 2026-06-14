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
- Colors the prompt editor border from the active mode or thinking level.

Modes can store a provider, model, thinking level, and optional color. Project-local modes live in `.pi/modes.json` when present; otherwise global modes live in `~/.pi/agent/modes.json`.

By default, Pi Mode does not print the mode name in the editor border. To opt in, toggle `Show mode name` from `/mode` → `Configure modes…`, or set `"modeShowName": true` in global `~/.pi/agent/settings.json` or trusted project `.pi/settings.json`. The `/mode` toggle writes to global settings.

## License

MIT
