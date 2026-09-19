# Pi UI Tweaks

<a href="https://www.npmjs.com/package/@zigai/pi-ui-tweaks"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-ui-tweaks.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-ui-tweaks"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-ui-tweaks.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/master/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-ui-tweaks.svg" style="display:inline-block;border:0" /></a>

Small configurable UI tweaks for polishing Pi's interface.

## Install

```sh
pi install npm:@zigai/pi-ui-tweaks
```

<!-- pi-extension-settings:start -->
## Configuration

Global settings are stored in `~/.pi/agent/extension-settings/pi-ui-tweaks.json`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enable all UI tweaks. |
| `autocompleteAboveInput` | boolean | `true` | Render autocomplete above the input editor. |
| `autoExpandPasteOnSubmit` | boolean | `true` | Automatically expand collapsed paste markers when prompt is submitted. |
| `bashExecPromptSpacing` | boolean | `true` | Add spacing around bash execution prompts. |
| `anchorInputToBottom` | boolean | `false` | Anchor the input editor to the terminal bottom. |
| `compactModelSelector` | boolean | `true` | Use compact model-selector rows. |
| `editorMaxHeight` | integer \| `unlimited` \| null | `"unlimited"` | Maximum visible height of the prompt editor box, or 'unlimited'. |
| `hideAutocompleteScrollInfo` | boolean | `true` | Hide autocomplete scroll-position text. |
| `hideModelChangeStatus` | boolean | `true` | Hide model-change status messages. |
| `hideModelProviderHint` | boolean | `true` | Hide provider hints in the model selector. |
| `hideSlashCommandSourceTags` | boolean | `true` | Hide source tags in slash-command completion. |
| `highlightSelectedModelProvider` | boolean | `true` | Highlight the selected model provider. |
| `inputPromptPrefix` | string | `"> "` | Prefix displayed before input text. |
| `neutralBorderColor` | boolean | `true` | Use a neutral border color when Pi is idle. |
| `pasteClickToExpand` | boolean | `true` | Expand collapsed paste markers when clicked with the mouse. |
| `pasteCollapseCharThreshold` | integer | `5000` | Character threshold that collapses pasted content. |
| `pasteCollapseEnabled` | boolean | `true` | Collapse large pasted content. |
| `pasteCollapseExpandKey` | string \| null | `null` | Explicit key used to expand collapsed pasted content. |
| `pasteCollapseLineThreshold` | integer | `80` | Line threshold that collapses pasted content. |
| `pasteCollapseUseToolExpandKey` | boolean | `true` | Reuse Pi's configured tool-expansion key for pasted content. |
| `pasteOffloadLineThreshold` | integer | `500` | Line threshold above which pastes are offloaded to disk files. |
| `pasteOffloadToDisk` | boolean | `false` | Save massive pastes exceeding offload threshold to temporary files. |
| `preserveCompactionHistory` | boolean | `false` | Keep pre-compaction messages visible in transcript history. |
| `restoreContentAfterAutocompleteClose` | boolean | `true` | Restore editor content after closing autocomplete. |
| `selectedOptionPrefix` | string | `"→ "` | Prefix displayed before selected list options. |
| `showEditorOverflowIndicators` | boolean | `true` | Show top and bottom line overflow indicators (e.g. ▲/▼) when text overflows visible viewport. |

```json
{
  "$schema": "./schemas/pi-ui-tweaks.schema.json",
  "enabled": true,
  "autocompleteAboveInput": true,
  "autoExpandPasteOnSubmit": true,
  "bashExecPromptSpacing": true,
  "anchorInputToBottom": false,
  "compactModelSelector": true,
  "editorMaxHeight": "unlimited",
  "hideAutocompleteScrollInfo": true,
  "hideModelChangeStatus": true,
  "hideModelProviderHint": true,
  "hideSlashCommandSourceTags": true,
  "highlightSelectedModelProvider": true,
  "inputPromptPrefix": "> ",
  "neutralBorderColor": true,
  "pasteClickToExpand": true,
  "pasteCollapseCharThreshold": 5000,
  "pasteCollapseEnabled": true,
  "pasteCollapseExpandKey": null,
  "pasteCollapseLineThreshold": 80,
  "pasteCollapseUseToolExpandKey": true,
  "pasteOffloadLineThreshold": 500,
  "pasteOffloadToDisk": false,
  "preserveCompactionHistory": false,
  "restoreContentAfterAutocompleteClose": true,
  "selectedOptionPrefix": "→ ",
  "showEditorOverflowIndicators": true
}
```
<!-- pi-extension-settings:end -->

## License

MIT
