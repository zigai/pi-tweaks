# Pi Tree

[![npm version](https://img.shields.io/npm/v/@zigai/pi-tree.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-tree)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-tree.svg)](https://www.npmjs.com/package/@zigai/pi-tree)
[![license](https://img.shields.io/npm/l/@zigai/pi-tree.svg)](../../LICENSE)

This Pi extension improves `/tree` with timestamps on every entry, a cleaner help/status line, and an optional right-side preview.

## Install

```sh
pi install npm:@zigai/pi-tree
```

## Features

- Shows per-entry timestamps in `/tree`.
- Supports `off`, `relative`, and `absolute` timestamp modes.
- Uses Pi's configured tree label-timestamp keybinding, commonly `Shift+T`, to cycle timestamp modes.
- Adds an optional selected-entry preview pane on the right side of `/tree` when the terminal is wide enough.
- Toggles the preview pane with `Shift+P`.
- Reads timestamp and preview choices from config.
- Can make `/tree` taller with `treeMaxVisibleLines`.
- Can keep the preview pane at full height or shrink it to fit preview content.

![Pi Tree preview demo](assets/tree-preview-demo.png)

## Configuration

Configure global settings at `~/.pi/agent/pi-tree/config.json`.

| Option                  | Type                                | Default      | Description                                                                                |
| ----------------------- | ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `treeTimestampMode`     | `"off" \| "relative" \| "absolute"` | `"relative"` | Initial timestamp mode.                                                                    |
| `treeSelectedPreview`   | `boolean`                           | `false`      | Opens `/tree` with the preview pane enabled.                                               |
| `treeMaxVisibleLines`   | `number`                            | unset        | Maximum number of tree rows to show. Omit to use Pi's native height; minimum value is `5`. |
| `treePreviewFullHeight` | `boolean`                           | `true`       | Keeps the preview pane at full height instead of shrinking it to selected preview content. |

```json
{
  "$schema": "./config.schema.json",
  "treeTimestampMode": "relative",
  "treeSelectedPreview": false,
  "treePreviewFullHeight": true
}
```

## Development

```sh
npm install
npm run check
```

## License

MIT
