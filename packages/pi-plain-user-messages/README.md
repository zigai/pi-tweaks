# Pi Plain User Messages

[![npm version](https://img.shields.io/npm/v/@zigai/pi-plain-user-messages.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-plain-user-messages)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-plain-user-messages.svg)](https://www.npmjs.com/package/@zigai/pi-plain-user-messages)
[![license](https://img.shields.io/npm/l/@zigai/pi-plain-user-messages.svg)](../../LICENSE)

This Pi extension renders user-submitted messages in the transcript as plain text instead of Markdown.

The goal is to keep prompts visually copyable exactly as written, including literal Markdown syntax such as `#`, `*`, backticks, links, and lists.

## Install

```sh
pi install npm:@zigai/pi-plain-user-messages
```

The extension only changes how user messages are rendered in the UI. It does not rewrite saved conversation content or change assistant response rendering.

## License

MIT
