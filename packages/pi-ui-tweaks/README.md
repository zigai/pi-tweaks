# Pi UI Tweaks

[![npm version](https://img.shields.io/npm/v/@zigai/pi-ui-tweaks.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-ui-tweaks)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-ui-tweaks.svg)](https://www.npmjs.com/package/@zigai/pi-ui-tweaks)
[![license](https://img.shields.io/npm/l/@zigai/pi-ui-tweaks.svg)](../../LICENSE)

This Pi extension collects small configurable UI tweaks that are too tiny to deserve standalone packages.

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
  "restoreContentAfterAutocompleteClose": true,
  "selectedOptionPrefix": "→ "
}
```

## License

MIT
