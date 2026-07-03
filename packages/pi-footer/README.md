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

| Option      | Type     | Default | Description                                                                                  |
| ----------- | -------- | ------- | -------------------------------------------------------------------------------------------- |
| `separator` | `string` | `"\|"`  | Visible separator placed between footer status segments. Whitespace-only values are ignored. |

```json
{
  "$schema": "./config.schema.json",
  "separator": "|"
}
```

## License

MIT
