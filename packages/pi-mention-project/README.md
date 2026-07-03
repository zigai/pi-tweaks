# Pi Mention Project

[![npm version](https://img.shields.io/npm/v/@zigai/pi-mention-project.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-mention-project)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-mention-project.svg)](https://www.npmjs.com/package/@zigai/pi-mention-project)
[![license](https://img.shields.io/npm/l/@zigai/pi-mention-project.svg)](../../LICENSE)

Type `#` to fuzzy-search your project folder. The completion inserts `#project-name`; the model receives the project's absolute path.

## Install

```sh
pi install npm:@zigai/pi-mention-project
```

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
