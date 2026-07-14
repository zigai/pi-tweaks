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

<!-- pi-extension-settings:start -->
## Configuration

Global settings are stored in `~/.pi/agent/extension-settings/pi-mention-project.json`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `trigger` | string | `"#"` | Single character that starts a project mention. |
| `roots` | string[] \| string | `[]` | Project root directory or directories searched for projects. |
| `gitReposOnly` | boolean | `true` | Include only directories containing Git repositories. |
| `includeDotFolders` | boolean | `false` | Include project directories whose names start with a dot. |
| `completionSuffix` | string | `" "` | Text inserted after a completed project mention. |

```json
{
  "$schema": "./schemas/pi-mention-project.schema.json",
  "trigger": "#",
  "roots": [],
  "gitReposOnly": true,
  "includeDotFolders": false,
  "completionSuffix": " "
}
```
<!-- pi-extension-settings:end -->

## License

MIT
