# Pi Tweaks

A collection of small Pi extensions for improving interaction, display, and model selection.

## Install

Install the full bundle from the root package:

```sh
pi install git:github.com/zigai/pi-tweaks
```

Or install only the individual packages you want from the package table.

## Packages

| Package                                                        | What it does                                                                                                     | Install                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`@zigai/pi-model-filter`](packages/pi-model-filter)           | Hides configured models from Pi model selection and lookup.                                                      | `pi install npm:@zigai/pi-model-filter`      |
| [`@zigai/pi-model-alias`](packages/pi-model-alias)             | Lets you give long provider model IDs short names.                                                               | `pi install npm:@zigai/pi-model-alias`       |
| [`@zigai/pi-tree`](packages/pi-tree)                           | Improves `/tree` with timestamps on every entry, a cleaner help/status line, and an optional right-side preview. | `pi install npm:@zigai/pi-tree`              |
| [`@zigai/pi-footer`](packages/pi-footer)                       | Replaces Pi's footer with a single compact plain-text status line.                                               | `pi install npm:@zigai/pi-footer`            |
| [`@zigai/pi-response-renderer`](packages/pi-response-renderer) | Makes assistant responses more compact.                                                                          | `pi install npm:@zigai/pi-response-renderer` |
| [`@zigai/pi-loader-time`](packages/pi-loader-time)             | Adds elapsed time to Pi loader messages.                                                                         | `pi install npm:@zigai/pi-loader-time`       |
| [`@zigai/pi-keymap-tweaks`](packages/pi-keymap-tweaks)         | Adds opinionated editor key behavior plus `Enter`/`Alt+Enter` submit-mode tweaks.                                | `pi install npm:@zigai/pi-keymap-tweaks`     |
| [`@zigai/pi-mode`](packages/pi-mode)                           | Adds prompt modes for model and thinking-level switching with editor border cues.                                | `pi install npm:@zigai/pi-mode`              |
| [`@zigai/pi-prompt-history`](packages/pi-prompt-history)       | Adds cross-session prompt history to the prompt editor.                                                          | `pi install npm:@zigai/pi-prompt-history`    |
| [`@zigai/pi-mention-skill`](packages/pi-mention-skill)         | Moves skills from slash autocomplete to `$` mention.                                                             | `pi install npm:@zigai/pi-mention-skill`     |
| [`@zigai/pi-trust`](packages/pi-trust)                         | Automatically trust all folders                                                                                  | `pi install npm:@zigai/pi-trust`             |

# License

MIT
