# Pi UI Tweaks

[![npm version](https://img.shields.io/npm/v/@zigai/pi-ui-tweaks.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-ui-tweaks)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-ui-tweaks.svg)](https://www.npmjs.com/package/@zigai/pi-ui-tweaks)
[![license](https://img.shields.io/npm/l/@zigai/pi-ui-tweaks.svg)](../../LICENSE)

This Pi extension collects small configurable UI tweaks that are too tiny to deserve standalone packages.

## Install

```sh
pi install npm:@zigai/pi-ui-tweaks
```

Or install the full tweak bundle:

```sh
pi install git:github.com/zigai/pi-tweaks
```

## Tweaks

- `autocompleteAboveInput` renders editor autocomplete menus above the input box, keeping the input box anchored while slash-command suggestions are open.
- `bashExecPromptSpacing` inserts a space after `!` when starting bash exec mode from an empty prompt, so commands appear as `! code .`.
- `anchorInputToBottom` pads short Pi screens with blank rows above the input/footer area, keeping the input at the terminal bottom.
- `compactModelSelector` removes extra blank spacer rows from the model picker.
- `hideAutocompleteScrollInfo` hides autocomplete count footers like `(1/38)`.
- `hideModelChangeStatus` hides redundant `Model: <id>` status lines after changing models.
- `hideModelProviderHint` hides Pi's built-in `Only showing models from configured providers. Use /login to add providers.` model picker hint.
- `hideSlashCommandSourceTags` hides source tags like `[u:npm:@plannotator/pi-extension]` from slash command autocomplete descriptions.
- `highlightSelectedModelProvider` highlights the selected model row's provider badge in the model picker.
- `inputPromptPrefix` changes the marker used by single-line input boxes. A trailing space is added automatically when omitted.
- `neutralBorderColor` renders Pi border lines with the normal text color instead of the theme border color.
- `restoreContentAfterAutocompleteClose` forces a clean redraw after above-input autocomplete closes, so content moves back down instead of leaving blank rows.
- `selectedOptionPrefix` changes the marker used for selected rows in selector UIs. A trailing space is added automatically when omitted.

## Settings

Configure global settings at `~/.pi/agent/pi-ui-tweaks/config.json`.

| Option                                 | Type      | Default | Description                                      |
| -------------------------------------- | --------- | ------- | ------------------------------------------------ |
| `enabled`                              | `boolean` | `true`  | Enables or disables every tweak in this package. |
| `autocompleteAboveInput`               | `boolean` | `true`  | Shows autocomplete above the input box.          |
| `bashExecPromptSpacing`                | `boolean` | `true`  | Adds a space after an empty-prompt `!`.          |
| `anchorInputToBottom`                  | `boolean` | `false` | Keeps short prompts anchored at the bottom.      |
| `compactModelSelector`                 | `boolean` | `true`  | Removes extra model picker spacer rows.          |
| `hideAutocompleteScrollInfo`           | `boolean` | `true`  | Hides autocomplete count footers.                |
| `hideModelChangeStatus`                | `boolean` | `true`  | Hides redundant model-change status lines.       |
| `hideModelProviderHint`                | `boolean` | `true`  | Hides Pi's configured-provider hint.             |
| `hideSlashCommandSourceTags`           | `boolean` | `true`  | Hides slash autocomplete source tags.            |
| `highlightSelectedModelProvider`       | `boolean` | `true`  | Highlights the selected row's provider badge.    |
| `inputPromptPrefix`                    | `string`  | `"> "`  | Sets the single-line input marker.               |
| `neutralBorderColor`                   | `boolean` | `true`  | Uses normal text color for border lines.         |
| `restoreContentAfterAutocompleteClose` | `boolean` | `true`  | Redraws content after above-input autocomplete.  |
| `selectedOptionPrefix`                 | `string`  | `"→ "`  | Sets the selected-row marker in selector UIs.    |

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
  "restoreContentAfterAutocompleteClose": true,
  "selectedOptionPrefix": "→ "
}
```

## License

MIT
