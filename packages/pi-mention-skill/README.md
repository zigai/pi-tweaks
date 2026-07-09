# Pi Mention Skill

<a href="https://www.npmjs.com/package/@zigai/pi-mention-skill"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-mention-skill.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-mention-skill"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-mention-skill.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-mention-skill.svg" style="display:inline-block;border:0" /></a>

Move Pi skill selection from slash autocomplete to `$` mentions.

## Install

```sh
pi install npm:@zigai/pi-mention-skill
```

## Features

- Adds fuzzy skill autocomplete with `$` mentions.
- Expands mentions such as `$skill-name` before the model sees the prompt.
- Keeps `/skill:*` entries out of slash autocomplete by default.

## Usage

Type `$` in the prompt editor to open skill suggestions, then select a skill.

The selected mention loads the same skill content that `/skill:name` would have loaded, while keeping skills out of the normal slash command picker.

## Configuration

Configure global settings at `~/.pi/agent/pi-mention-skill/config.json`.

| Option             | Type      | Default | Description                                                     |
| ------------------ | --------- | ------- | --------------------------------------------------------------- |
| `trigger`          | `string`  | `"$"`   | Single non-whitespace mention character. It cannot be `/`.      |
| `hideSlashSkills`  | `boolean` | `true`  | Hides `/skill:*` entries from Pi's default slash autocomplete.  |
| `completionSuffix` | `string`  | `" "`   | Text inserted after a selected mention. Use `""` for no suffix. |

```json
{
  "$schema": "./config.schema.json",
  "trigger": "$",
  "hideSlashSkills": true,
  "completionSuffix": " "
}
```

## License

MIT
