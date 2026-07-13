# Pi UI Tweaks

<a href="https://www.npmjs.com/package/@zigai/pi-ui-tweaks"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-ui-tweaks.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-ui-tweaks"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-ui-tweaks.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/master/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-ui-tweaks.svg" style="display:inline-block;border:0" /></a>

Small configurable UI tweaks for polishing Pi's interface.

## Install

```sh
pi install npm:@zigai/pi-ui-tweaks
```

## Settings

Configure global settings at `~/.pi/agent/pi-ui-tweaks/config.json`.

| Option                                 | Type             | Default | Description                                            |
| -------------------------------------- | ---------------- | ------- | ------------------------------------------------------ |
| `enabled`                              | `boolean`        | `true`  | Enables or disables every tweak in this package.       |
| `autocompleteAboveInput`               | `boolean`        | `true`  | Shows autocomplete above the input box.                |
| `bashExecPromptSpacing`                | `boolean`        | `true`  | Adds a space after an empty-prompt `!`.                |
| `anchorInputToBottom`                  | `boolean`        | `false` | Keeps short prompts anchored at the bottom.            |
| `compactModelSelector`                 | `boolean`        | `true`  | Removes extra model picker spacer rows.                |
| `hideAutocompleteScrollInfo`           | `boolean`        | `true`  | Hides autocomplete count footers.                      |
| `hideModelChangeStatus`                | `boolean`        | `true`  | Hides redundant model-change status lines.             |
| `hideModelProviderHint`                | `boolean`        | `true`  | Hides Pi's configured-provider hint.                   |
| `hideSlashCommandSourceTags`           | `boolean`        | `true`  | Hides slash autocomplete source tags.                  |
| `highlightSelectedModelProvider`       | `boolean`        | `true`  | Highlights the selected row's provider badge.          |
| `inputPromptPrefix`                    | `string`         | `"> "`  | Sets the single-line input marker.                     |
| `neutralBorderColor`                   | `boolean`        | `true`  | Uses normal text color for border lines.               |
| `pasteCollapseCharThreshold`           | `number`         | `1000`  | Collapses pastes with more than this many chars.       |
| `pasteCollapseEnabled`                 | `boolean`        | `true`  | Collapses large pasted text into paste markers.        |
| `pasteCollapseExpandKey`               | `string \| null` | `null`  | Extra Pi key id for expanding the marker under cursor. |
| `pasteCollapseLineThreshold`           | `number`         | `10`    | Collapses pastes with more than this many lines.       |
| `pasteCollapseUseToolExpandKey`        | `boolean`        | `true`  | Lets Pi's expand key expand paste markers.             |
| `preserveCompactionHistory`            | `boolean`        | `false` | Keeps the live terminal transcript after compaction.   |
| `restoreContentAfterAutocompleteClose` | `boolean`        | `true`  | Redraws content after above-input autocomplete.        |
| `selectedOptionPrefix`                 | `string`         | `"→ "`  | Sets the selected-row marker in selector UIs.          |

```json
{
  "$schema": "./config.schema.json",
  "enabled": true,
  "autocompleteAboveInput": true,
  "bashExecPromptSpacing": true,
  "anchorInputToBottom": false,
  "compactModelSelector": true,
  "hideAutocompleteScrollInfo": true,
  "hideModelChangeStatus": true,
  "hideModelProviderHint": true,
  "hideSlashCommandSourceTags": true,
  "highlightSelectedModelProvider": true,
  "inputPromptPrefix": "> ",
  "neutralBorderColor": true,
  "pasteCollapseCharThreshold": 1000,
  "pasteCollapseEnabled": true,
  "pasteCollapseExpandKey": null,
  "pasteCollapseLineThreshold": 10,
  "pasteCollapseUseToolExpandKey": true,
  "preserveCompactionHistory": false,
  "restoreContentAfterAutocompleteClose": true,
  "selectedOptionPrefix": "→ "
}
```

## Render tracing

For intermittent repaint problems, start Pi with render tracing enabled:

```sh
PI_UI_TWEAKS_RENDER_TRACE=1 pi
```

The trace is written to `~/.pi/agent/pi-ui-tweaks/render-trace-<pid>.jsonl`. It records row styles and terminal control operations without recording visible message text. Set `PI_UI_TWEAKS_RENDER_TRACE_FILE` to use a specific output path.

## License

MIT
