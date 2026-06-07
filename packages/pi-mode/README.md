# Pi Mode

This Pi extension adds prompt modes for model and thinking-level switching.

## Install

```sh
pi install git:github.com/zigai/pi-ux-tweaks
```

## Features

- Adds `/mode` for selecting and configuring prompt modes.
- Adds `Ctrl+Shift+M` to select a mode.
- Adds `Ctrl+Space` to cycle modes.
- Shows the current mode in the prompt editor border.
- Colors the prompt editor border from the active mode or thinking level.

Modes can store a provider, model, thinking level, and optional color. Project-local modes live in `.pi/modes.json` when present; otherwise global modes live in `~/.pi/agent/modes.json`.
