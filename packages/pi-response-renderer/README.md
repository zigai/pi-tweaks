# Pi Response Renderer

[![npm version](https://img.shields.io/npm/v/@zigai/pi-response-renderer.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-response-renderer)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-response-renderer.svg)](https://www.npmjs.com/package/@zigai/pi-response-renderer)
[![license](https://img.shields.io/npm/l/@zigai/pi-response-renderer.svg)](../../LICENSE)

This Pi extension makes assistant responses more compact by tightening extra blank lines and hiding Markdown code fence markers.

It applies a few small rendering tweaks:

- hides the visible ``` fence lines around rendered Markdown code blocks in assistant messages
- collapses paragraph gaps without squeezing tables or headings
- removes italic ANSI styling from assistant message output

The goal is a cleaner transcript with less visual noise while keeping the message content itself unchanged.

## Install

```sh
pi install npm:@zigai/pi-response-renderer
```

The extension only changes how messages are rendered in the UI. It does not rewrite saved conversation content.

## Screenshots

Before:

![Pi Response Renderer before screenshot](assets/response-renderer-before.png)

After:

![Pi Response Renderer after screenshot](assets/response-renderer-after.png)

## License

MIT
