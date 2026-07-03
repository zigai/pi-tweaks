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

## Configuration

Configure global settings at `~/.pi/agent/pi-run-timer/config.json`.

| Option                                 | Type       | Default  | Description                                                                                               |
| -------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `rightMessages`                        | `object`   | disabled | Rotating right-side working-bar messages.                                                                 |
| `rightMessages.enabled`                | `boolean`  | `false`  | Enables messages. If omitted, messages turn on when any are loaded.                                       |
| `rightMessages.intervalMs`             | `integer`  | `10000`  | Time between message rotations.                                                                           |
| `rightMessages.minGap`                 | `integer`  | `4`      | Minimum spacing between status text and right-side message.                                               |
| `rightMessages.minScrollCycles`        | `integer`  | `1`      | Minimum full scroll passes before a long message rotates.                                                 |
| `rightMessages.scrollColumnIntervalMs` | `integer`  | `120`    | Horizontal scroll speed for long messages.                                                                |
| `rightMessages.dimmed`                 | `boolean`  | `true`   | Renders messages dimmed.                                                                                  |
| `rightMessages.italic`                 | `boolean`  | `true`   | Renders messages italic.                                                                                  |
| `rightMessages.messages`               | `string[]` | `[]`     | Inline messages.                                                                                          |
| `rightMessages.messagesFile`           | `string`   | unset    | Text file with one message per non-empty, non-comment line. Relative paths use the config file directory. |

```json
{
  "$schema": "./config.schema.json",
  "rightMessages": {
    "enabled": false,
    "intervalMs": 10000,
    "minGap": 4,
    "minScrollCycles": 1,
    "scrollColumnIntervalMs": 120,
    "dimmed": true,
    "italic": true,
    "messages": []
  }
}
```

## License

MIT
