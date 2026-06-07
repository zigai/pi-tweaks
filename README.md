# Pi UX Tweaks

A collection of small Pi extensions for improving interaction, display, and model-selection UX.

## Install

Install the full bundle from the root package:

```sh
pi install git:github.com/zigai/pi-ux-tweaks
```

Or install only the individual packages you want from the package table.

## Packages

| Package                                                        | What it does                                                                                                     | Install                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`@zigai/pi-model-filter`](packages/pi-model-filter)           | Hides configured models from Pi model selection and lookup.                                                      | `pi install npm:@zigai/pi-model-filter`      |
| [`@zigai/pi-model-alias`](packages/pi-model-alias)             | Lets you give long provider model IDs short names.                                                               | `pi install npm:@zigai/pi-model-alias`       |
| [`@zigai/pi-tree`](packages/pi-tree)                           | Improves `/tree` with timestamps on every entry, a cleaner help/status line, and an optional right-side preview. | `pi install npm:@zigai/pi-tree`              |
| [`@zigai/pi-footer`](packages/pi-footer)                       | Replaces Pi's footer with a single compact plain-text status line.                                               | `pi install npm:@zigai/pi-footer`            |
| [`@zigai/pi-response-renderer`](packages/pi-response-renderer) | Makes assistant responses more compact by tightening extra blank lines and hiding Markdown code fence markers.   | `pi install npm:@zigai/pi-response-renderer` |
| [`@zigai/pi-loader-time`](packages/pi-loader-time)             | Adds elapsed time to Pi loader messages so long-running work shows how long it has been waiting.                 | `pi install npm:@zigai/pi-loader-time`       |
| [`@zigai/pi-submit-mode`](packages/pi-submit-mode)             | Makes `Enter` queue a follow-up and `Alt+Enter` steer the current run.                                           | `pi install npm:@zigai/pi-submit-mode`       |
| [`@zigai/pi-mode`](packages/pi-mode)                           | Adds prompt modes for model and thinking-level switching with editor border cues.                                | `pi install npm:@zigai/pi-mode`              |
| [`@zigai/pi-prompt-history`](packages/pi-prompt-history)       | Adds cross-session prompt history to the prompt editor.                                                          | `pi install npm:@zigai/pi-prompt-history`    |

# License

MIT
