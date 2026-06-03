# Pi Tree

Pi extension for customizing session tree display.

## Install

```sh
pi install @zigai/pi-tree
```

## Features

- Adds per-entry timestamps to `/tree`.
- Supports `off`, `relative`, and `absolute` timestamp modes.
- Reuses Pi's tree label-timestamp keybinding to cycle modes.
- Adds an optional selected-entry preview pane on the right side of `/tree`.
- Toggles the preview pane with `Shift+P`; it is off by default.
- Persists the selected timestamp mode in Pi settings as `treeTimestampMode`.
- Persists the preview pane toggle in Pi settings as `treeSelectedPreview`.
- Supports optional `treeMaxVisibleLines` in Pi settings to allow taller `/tree` lists and longer previews; when unset, Pi's native height is used, and configured values are clamped to a minimum of 5.
- Supports optional `treePreviewFullHeight` in Pi settings. It defaults to `true`, keeping preview mode at the full configured height even when the selected preview has fewer lines; set it to `false` to shrink to the preview content height.

## Development

```sh
npm install
npm run check
```
