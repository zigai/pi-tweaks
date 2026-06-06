# Pi UI Tweaks

A collection of small Pi extensions that make the terminal UI easier to read and a little more personal.

Each package can be installed on its own. Open a package README for full details.

## Extensions

| Package                                                        | What it does                                                                                                     | Install                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`@zigai/pi-footer`](packages/pi-footer)                       | Replaces Pi's footer with a single compact plain-text status line.                                               | `npm install @zigai/pi-footer`            |
| [`@zigai/pi-loader-time`](packages/pi-loader-time)             | Adds elapsed time to Pi loader messages so long-running work shows how long it has been waiting.                 | `npm install @zigai/pi-loader-time`       |
| [`@zigai/pi-model-alias`](packages/pi-model-alias)             | Lets you give long provider model IDs short names.                                                               | `npm install @zigai/pi-model-alias`       |
| [`@zigai/pi-response-renderer`](packages/pi-response-renderer) | Makes assistant responses more compact by tightening extra blank lines and hiding Markdown code fence markers.   | `npm install @zigai/pi-response-renderer` |
| [`@zigai/pi-submit-mode`](packages/pi-submit-mode)             | Makes `Enter` queue a follow-up and `Alt+Enter` steer the current run.                                           | `npm install @zigai/pi-submit-mode`       |
| [`@zigai/pi-tree`](packages/pi-tree)                           | Improves `/tree` with timestamps on every entry, a cleaner help/status line, and an optional right-side preview. | `npm install @zigai/pi-tree`              |

## Development

```sh
npm install
npm run check
```
