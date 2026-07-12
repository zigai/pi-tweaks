# Pi Mention Project

<a href="https://www.npmjs.com/package/@zigai/pi-mention-project"><img alt="npm version" src="https://img.shields.io/npm/v/@zigai/pi-mention-project.svg?color=blue" style="display:inline-block;border:0" /></a> <a href="https://www.npmjs.com/package/@zigai/pi-mention-project"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@zigai/pi-mention-project.svg" style="display:inline-block;border:0" /></a> <a href="https://github.com/zigai/pi-tweaks/blob/master/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/@zigai/pi-mention-project.svg" style="display:inline-block;border:0" /></a>

Use short `#project` mentions while typing in Pi; submitted messages show the matching absolute project path.

```text
#pi-tweaks update the package README
```

Type `#pi-tweaks` and select the project from autocomplete. When submitted, the visible message and the model context use the matching path, such as `/home/you/Projects/pi-tweaks`.

## Install

```sh
pi install npm:@zigai/pi-mention-project
```

## Usage

- Type `#` to fuzzy-search configured project folders.
- Pick a project to insert a mention such as `#pi-tweaks`.
- Submitting the message replaces known mentions with their absolute paths.
- Use quoted mentions for names with spaces, such as `#"My Project"`.
- Unknown mentions stay unchanged.

## Configuration

Configure global settings at `~/.pi/agent/pi-mention-project/config.json`.

| Option              | Type                 | Default | Description                                                     |
| ------------------- | -------------------- | ------- | --------------------------------------------------------------- |
| `trigger`           | `string`             | `"#"`   | Single non-whitespace mention character. It cannot be `/`.      |
| `roots`             | `string \| string[]` | `[]`    | Project search roots.                                           |
| `gitReposOnly`      | `boolean`            | `true`  | Lists only folders that are Git repos.                          |
| `includeDotFolders` | `boolean`            | `false` | Includes folders whose names start with `.`.                    |
| `completionSuffix`  | `string`             | `" "`   | Text inserted after a selected mention. Use `""` for no suffix. |

```json
{
  "$schema": "./config.schema.json",
  "trigger": "#",
  "roots": [],
  "gitReposOnly": true,
  "includeDotFolders": false,
  "completionSuffix": " "
}
```

## License

MIT
