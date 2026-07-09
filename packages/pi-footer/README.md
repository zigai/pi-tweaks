# Pi Footer

<a href="https://www.npmjs.com/package/@zigai/pi-footer"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-footer.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-footer"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-footer.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/master/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-footer.svg" style="display:inline-block;border:0" /></a>

A minimalistic, single-line replacement for Pi's footer.

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
