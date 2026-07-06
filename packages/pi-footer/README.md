# Pi Footer

[![npm version](https://img.shields.io/npm/v/@zigai/pi-footer.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-footer)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-footer.svg)](https://www.npmjs.com/package/@zigai/pi-footer)
[![license](https://img.shields.io/npm/l/@zigai/pi-footer.svg)](../../LICENSE)

This Pi extension replaces Pi's footer with a single compact plain-text status line.

![Pi Footer screenshot](assets/footer.png)

Footer contents:

- current working directory
- git branch
- provider and model
- thinking level
- MCP status
- context usage

## Install

```sh
pi install npm:@zigai/pi-footer
```

## Configuration

Configure global settings at `~/.pi/agent/pi-footer/config.json`.

| Option          | Type       | Default                                               | Description                                                                                  |
| --------------- | ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `separator`     | `string`   | `"·"`                                                 | Visible separator placed between footer status segments. Whitespace-only values are ignored. |
| `layout.left`   | `string[]` | `["path", "branch", "provider", "model", "thinking"]` | Left-side slot order. Earlier slots are kept first when the footer narrows.                  |
| `layout.right`  | `string[]` | `["context"]`                                         | Right-side slot order. Later slots are kept first when the footer narrows.                   |
| `layout.hidden` | `string[]` | `[]`                                                  | Slots omitted even when configured on a side or registered by another extension.             |

```json
{
  "$schema": "./config.schema.json",
  "separator": "·",
  "layout": {
    "left": ["path", "branch", "provider", "model", "thinking"],
    "right": ["context"],
    "hidden": []
  }
}
```

Custom slots registered by other extensions use namespaced ids such as `my-extension.status`.

## Extension API

Other extensions can register custom footer slots through `@zigai/pi-footer/api`.

```ts
import { registerFooterSlot } from "@zigai/pi-footer/api";

const status = registerFooterSlot({
  id: "my-extension.status",
  defaultSide: "right",
  text: "ready",
});

status.setText("working");
status.clear();
status.dispose();
```

## License

MIT
