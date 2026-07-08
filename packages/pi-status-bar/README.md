# Pi Status Bar

[![npm version](https://img.shields.io/npm/v/@zigai/pi-status-bar.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-status-bar)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-status-bar.svg)](https://www.npmjs.com/package/@zigai/pi-status-bar)
[![license](https://img.shields.io/npm/l/@zigai/pi-status-bar.svg)](../../LICENSE)

Adds a coherent programmable status bar to Pi:

- active working-line status with spinner, text, elapsed time, and optional right-side messages
- idle post-run status, such as `Worked for 1m 12s. [45 tok/s]`
- an extension API for changing active text, spinner frames, timer state, idle text, and custom status segments

This package intentionally stays single-line and status-focused. For richer UI above the editor, use Pi's built-in API's.

## Install

```sh
pi install npm:@zigai/pi-status-bar
```

## Configuration

Configure global settings at `~/.pi/agent/pi-status-bar/config.json`.

| Option                                 | Type       | Default | Description                                                                                               |
| -------------------------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `statusBar.active.text`                | `string`   | unset   | Active working text override. When unset, Pi's current loader message is used.                            |
| `statusBar.active.spinner.frames`      | `string[]` | unset   | Active spinner frame override. When unset, Pi's current loader frames are used.                           |
| `statusBar.active.timer.visible`       | `boolean`  | `true`  | Shows elapsed time in the active line.                                                                    |
| `statusBar.active.timer.paused`        | `boolean`  | `false` | Starts the active elapsed timer paused.                                                                   |
| `statusBar.idle.text`                  | `string`   | unset   | Idle status text shown before the last-run summary.                                                       |
| `statusBar.idle.visible`               | `boolean`  | `true`  | Shows the idle status widget.                                                                             |
| `statusBar.idle.showLastRunSummary`    | `boolean`  | `true`  | Shows the default `Worked for ...` summary in the idle status bar.                                        |
| `rightMessages.enabled`                | `boolean`  | `false` | Enables rotating right-side active messages. If omitted, messages turn on when any are loaded.            |
| `rightMessages.intervalMs`             | `integer`  | `10000` | Time between message rotations.                                                                           |
| `rightMessages.minGap`                 | `integer`  | `4`     | Minimum spacing between active status text and right-side message.                                        |
| `rightMessages.minScrollCycles`        | `integer`  | `1`     | Minimum full scroll passes before a long message rotates.                                                 |
| `rightMessages.scrollColumnIntervalMs` | `integer`  | `120`   | Horizontal scroll speed for long messages.                                                                |
| `rightMessages.dimmed`                 | `boolean`  | `true`  | Renders messages dimmed.                                                                                  |
| `rightMessages.italic`                 | `boolean`  | `true`  | Renders messages italic.                                                                                  |
| `rightMessages.messages`               | `string[]` | `[]`    | Inline messages.                                                                                          |
| `rightMessages.messagesFile`           | `string`   | unset   | Text file with one message per non-empty, non-comment line. Relative paths use the config file directory. |

```json
{
  "$schema": "./config.schema.json",
  "statusBar": {
    "active": {
      "timer": {
        "visible": true,
        "paused": false
      }
    },
    "idle": {
      "visible": true,
      "showLastRunSummary": true
    }
  },
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

## Extension API

Other extensions can program the active and idle status bar through `@zigai/pi-status-bar/api`.

```ts
import { configureStatusBar, registerStatusBarSegment } from "@zigai/pi-status-bar/api";

const statusBar = configureStatusBar({
  active: {
    text: "Searching docs",
    spinner: { frames: ["◐", "◓", "◑", "◒"] },
  },
  idle: {
    text: "Ready",
    showLastRunSummary: true,
  },
});

statusBar.pauseTimer();
statusBar.resumeTimer();
statusBar.resetTimer();
statusBar.setActiveText("Running tests");
statusBar.setIdleText("Last run finished");
statusBar.dispose();
```

Custom segments can appear in the active line, idle line, or both.

```ts
const segment = registerStatusBarSegment({
  id: "my-extension.status",
  states: ["active", "idle"],
  side: "right",
  text: "review",
  priority: 50,
});

segment.setText("typechecking");
segment.clear();
segment.dispose();
```

## License

MIT
