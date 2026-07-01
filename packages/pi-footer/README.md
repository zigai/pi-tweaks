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

Add `footer.separator` to `~/.pi/agent/settings.json` or a trusted project `.pi/settings.json`:

```json
{
  "footer": {
    "separator": "·"
  }
}
```

The default separator is `|`.

## License

MIT
