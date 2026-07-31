# @zigai/pi-message-highlights

Highlights URLs and file paths in Pi's interactive UI:

- URLs render in a configurable blue foreground by default.
- File paths render with Pi's accent/highlight color.
- Applies to assistant responses, past user messages, and the prompt editor.

## Install

```sh
pi install npm:@zigai/pi-message-highlights
```

<!-- pi-extension-settings:start -->
## Configuration

Global settings are stored in `~/.pi/agent/extension-settings/pi-message-highlights.json`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `urlColor` | integer \| `` \| string \| `accent` \| `border` \| `borderAccent` \| `borderMuted` \| `success` \| `error` \| `warning` \| `muted` \| `dim` \| `text` \| `thinkingText` \| `userMessageText` \| `customMessageText` \| `customMessageLabel` \| `toolTitle` \| `toolOutput` \| `mdHeading` \| `mdLink` \| `mdLinkUrl` \| `mdCode` \| `mdCodeBlock` \| `mdCodeBlockBorder` \| `mdQuote` \| `mdQuoteBorder` \| `mdHr` \| `mdListBullet` \| `toolDiffAdded` \| `toolDiffRemoved` \| `toolDiffContext` \| `syntaxComment` \| `syntaxKeyword` \| `syntaxFunction` \| `syntaxVariable` \| `syntaxString` \| `syntaxNumber` \| `syntaxType` \| `syntaxOperator` \| `syntaxPunctuation` \| `thinkingOff` \| `thinkingMinimal` \| `thinkingLow` \| `thinkingMedium` \| `thinkingHigh` \| `thinkingXhigh` \| `bashMode` | `"#87d7ff"` | URL color as an ANSI-256 index, hex color, theme color name, or empty string to disable highlighting. |

<details>
<summary>Complete default settings</summary>

```json
{
  "$schema": "./schemas/pi-message-highlights.schema.json",
  "urlColor": "#87d7ff"
}
```

</details>
<!-- pi-extension-settings:end -->

## License

MIT
