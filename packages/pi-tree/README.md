# Pi Tree

<a href="https://www.npmjs.com/package/@zigai/pi-tree"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-tree.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-tree"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-tree.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-tree.svg" style="display:inline-block;border:0" /></a>

A cleaner, more informative `/tree` for Pi.

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
