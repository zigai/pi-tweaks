# Pi Tree

This Pi extension improves `/tree` with timestamps on every entry, a cleaner help/status line, and an optional right-side preview.

The preview helps when scanning a long session because you can inspect message content without opening each branch.

## Install

```sh
pi install git:github.com/zigai/pi-ux-tweaks
```

## Features

- Shows per-entry timestamps in `/tree`.
- Supports `off`, `relative`, and `absolute` timestamp modes.
- Uses Pi's tree label-timestamp keybinding, usually `Shift+T`, to cycle timestamp modes.
- Adds an optional selected-entry preview pane on the right side of `/tree`.
- Toggles the preview pane with `Shift+P`.
- Persists timestamp and preview choices in `~/.pi/agent/settings.json`.
- Can make `/tree` taller with `treeMaxVisibleLines`.
- Can keep the preview pane at full height or shrink it to fit preview content.

## Configuration

Configuration is stored in Pi's settings file:

```json
{
  "treeTimestampMode": "relative",
  "treeSelectedPreview": false,
  "treeMaxVisibleLines": 24,
  "treePreviewFullHeight": true
}
```

Settings:

- `treeTimestampMode`: one of `off`, `relative`, or `absolute`. Defaults to `relative`.
- `treeSelectedPreview`: set to `true` to open `/tree` with the preview pane enabled. Defaults to `false`.
- `treeMaxVisibleLines`: optional maximum number of tree rows to show. When unset, Pi's native height is used. Values are clamped to at least `5`.
- `treePreviewFullHeight`: set to `false` if the preview pane should shrink when the selected preview has only a few lines. Defaults to `true`.

You can also change the first two settings from inside `/tree`: use the tree time keybinding to cycle timestamp modes, and `Shift+P` to toggle the preview pane.

## Development

```sh
npm install
npm run check
```
