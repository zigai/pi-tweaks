# Pi Run Timer

[![npm version](https://img.shields.io/npm/v/@zigai/pi-run-timer.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-run-timer)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-run-timer.svg)](https://www.npmjs.com/package/@zigai/pi-run-timer)
[![license](https://img.shields.io/npm/l/@zigai/pi-run-timer.svg)](../../LICENSE)

Adds runtime timing details to Pi:

- live loader elapsed time, such as `Thinking (12s)` or `Running command (2m 05s)`
- optional rotating right-side working-bar messages
- a post-run summary widget, such as `Worked for 1m 12s. [45 tok/s]`

## Install

```sh
pi install npm:@zigai/pi-run-timer
```

## Rotating right-side messages

Configure `runTimer.rightMessages` in `~/.pi/agent/settings.json` or trusted project `.pi/settings.json`:

```json
{
  "runTimer": {
    "rightMessages": {
      "messagesFile": "run-timer-tips.txt"
    }
  }
}
```

The file is UTF-8 text with one message per non-empty line. Lines starting with `#` are ignored. Relative global paths resolve from `~/.pi/agent`; relative project paths resolve from the project root.

Inline messages and display options are also supported:

```json
{
  "runTimer": {
    "rightMessages": {
      "intervalMs": 10000,
      "minScrollCycles": 1,
      "scrollColumnIntervalMs": 120,
      "dimmed": true,
      "italic": true,
      "messages": ["Tip: use $skill mentions", "Tip: /tree shows branches"]
    }
  }
}
```

If `enabled` is omitted, messages turn on when at least one message is loaded. Long messages slide horizontally before rotating.

## License

MIT
