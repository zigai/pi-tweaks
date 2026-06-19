# Pi Mention Project

[![npm version](https://img.shields.io/npm/v/@zigai/pi-mention-project.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-mention-project)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-mention-project.svg)](https://www.npmjs.com/package/@zigai/pi-mention-project)
[![license](https://img.shields.io/npm/l/@zigai/pi-mention-project.svg)](../../LICENSE)

Type `#` to fuzzy-search your project folder. The completion inserts `#project-name`; the model receives the project's absolute path.

## Install

```sh
pi install npm:@zigai/pi-mention-project
```

## Config

Add roots in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "mentionProjectRoots": ["~/Projects"]
}
```

By default it lists only direct child folders that:

- are Git repos (`.git` directory or worktree file)
- do not start with `.`

Optional settings:

```json
{
  "mentionProjectTrigger": "#",
  "mentionProjectGitReposOnly": true,
  "mentionProjectIncludeDotFolders": false
}
```

## License

MIT
