# @zigai/pi-message-highlights

Highlights URLs and file paths in Pi's interactive UI:

- URLs render in a configurable blue foreground by default.
- File paths render with Pi's accent/highlight color.
- Applies to assistant responses, past user messages, and the prompt editor.

## Install

```sh
pi install npm:@zigai/pi-message-highlights
```

## Configuration

Configure global settings at `~/.pi/agent/pi-message-highlights/config.json`.

| Option     | Type               | Default | Description                                                                                                                               |
| ---------- | ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `urlColor` | `number \| string` | `117`   | URL foreground color. Use a 0-255 ANSI color, `#RRGGBB`, empty string to disable URL color, or a Pi theme role like `mdLink` or `accent`. |

```json
{
  "$schema": "./config.schema.json",
  "urlColor": 117
}
```

## License

MIT
