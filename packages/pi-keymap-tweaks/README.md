# Pi Keymap Tweaks

[![npm version](https://img.shields.io/npm/v/@zigai/pi-keymap-tweaks.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-keymap-tweaks)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-keymap-tweaks.svg)](https://www.npmjs.com/package/@zigai/pi-keymap-tweaks)
[![license](https://img.shields.io/npm/l/@zigai/pi-keymap-tweaks.svg)](../../LICENSE)

This Pi extension collects opinionated editor and message-submit key tweaks.

## Features

- Makes `Enter` queue a follow-up and `Alt+Enter` steer the current run.
- Normalizes terminal `LF` Enter input to submit correctly in SSH/TMUX sessions.
- Adds Codex-style line start/end behavior for Pi's configured `tui.editor.cursorLineStart` and `tui.editor.cursorLineEnd` actions:
  - line start moves to the previous line when already at column 0
  - line end moves to the next line when already at the current line end

## Recommended keybindings

This extension provides behavior; key assignments still live in your Pi keybindings config.

```json
{
  "tui.editor.cursorWordLeft": ["ctrl+a", "ctrl+left", "alt+left", "alt+b"],
  "tui.editor.cursorWordRight": ["ctrl+d", "ctrl+right", "alt+right", "alt+f"],
  "tui.editor.cursorLineStart": ["home", "ctrl+q"],
  "tui.editor.cursorLineEnd": ["end", "ctrl+e"],
  "tui.editor.deleteCharForward": ["delete"]
}
```

## Install

```sh
pi install npm:@zigai/pi-keymap-tweaks
```

## License

MIT
