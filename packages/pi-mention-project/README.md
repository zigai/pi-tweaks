# Pi Mention Project

[![npm version](https://img.shields.io/npm/v/@zigai/pi-mention-project.svg?color=blue)](https://www.npmjs.com/package/@zigai/pi-mention-project)
[![npm downloads](https://img.shields.io/npm/dm/@zigai/pi-mention-project.svg)](https://www.npmjs.com/package/@zigai/pi-mention-project)
[![license](https://img.shields.io/npm/l/@zigai/pi-mention-project.svg)](../../LICENSE)

This Pi extension adds fuzzy project directory mentions that default to `#`.

## Install

```sh
pi install npm:@zigai/pi-mention-project
```

## Features

- Adds fuzzy autocomplete for project folders with `#` mentions.
- Searches only the direct child folders inside configured project roots.
- Defaults to Git repository folders and ignores dot-prefixed folders.
- Expands project mentions before the model sees the prompt so the model gets each project's absolute path.

## Usage

Configure one or more project roots, then type `#` in the prompt editor and start typing a folder name.

If `~/Projects` contains `pi-tweaks`, selecting `#pi-tweaks` adds that project mention. Before the model sees the prompt, the extension prepends project metadata with the absolute project path and removes the `#` sigil from the visible sentence.

## Configuration

Configuration lives in Pi settings: globally in `~/.pi/agent/settings.json`, or per trusted project in `.pi/settings.json`.

Project roots default to an empty list. Set `mentionProjectRoots` to the directories whose direct child folders should be mentionable:

```json
{
  "mentionProjectRoots": ["~/Projects", "~/Work"]
}
```

Only immediate child directories are listed. For example, `~/Projects/app` is mentionable, but `~/Projects/app/packages/api` is not.

By default, a child folder is listed only when it has a `.git` directory or worktree `.git` file, and folders whose names start with `.` are hidden. To include non-Git folders, set `mentionProjectGitReposOnly` to `false`:

```json
{
  "mentionProjectGitReposOnly": false
}
```

To include dot-prefixed folders, set `mentionProjectIncludeDotFolders` to `true`:

```json
{
  "mentionProjectIncludeDotFolders": true
}
```

For one-off runs, the same filters can be relaxed with CLI flags:

```sh
pi --mention-project-include-non-git --mention-project-include-dot-folders
```

The mention character defaults to `#`. To change it, set `mentionProjectTrigger` to a single non-whitespace character:

```json
{
  "mentionProjectTrigger": "@"
}
```

Folder names should be unique across configured roots. If the same folder name exists in multiple roots, the first configured root wins.

## License

MIT
