# conductor-worktrunk

Worktrunk plugin for herdr-gui: create and delete git worktrees with
[worktrunk](https://worktrunk.dev) (`wt`) from Herdr dialogs.

## What's here

| Path | What it is |
|---|---|
| `mods/worktrunk-create/` | **New worktree** dialog. Type a branch name; it runs `wt switch [--create] <branch> --no-cd` in the focused space's repo and opens the new worktree as a space. |
| `mods/worktrunk-delete/` | **Remove worktree** dialog. Runs `wt remove` on the focused space's worktree, so worktrunk's remove hooks run, then closes the space. |
| `keys.json` | The key bindings the mods expect: `cmd-shift-n` opens the create dialog, `cmd-shift-backspace` the delete dialog. |

The two mods are independent: install either or both.

### `worktrunk-create`

- **Location:** worktrunk's `worktree-path` setting decides where the worktree goes.
- **Branches:** a new branch starts from the default branch; an existing branch is checked out into a new worktree.
- **Hooks:** `pre-start` hooks run while the dialog waits; `post-start` and `post-switch` hooks run in the background, as worktrunk normally runs them. If a hook fails after the worktree exists, the space still opens and a warning notification shows.
- **Approvals:** worktrunk can't prompt inside a dialog. If the project has hooks you haven't approved, the dialog lists the commands and runs nothing until you click **Approve and create**, which saves the approval like `wt config approvals add`.
- **Already open:** if the worktree already has a space, it switches to that space.

### `worktrunk-delete`

- **What it deletes:** the worktree the focused space is in. It refuses in a repo's main checkout or outside git.
- **Hooks:** runs `wt remove <path> --foreground` from the main checkout, so `pre-remove` and `post-remove` hooks run.
- **Branch:** follows worktrunk's rule: deleted if merged, otherwise kept. When the branch is kept, a notification says why.
- **Uncommitted changes:** the dialog warns that they'll be lost, then removes with `--force`. Changes that appear after the dialog opens get one more warning first.
- **Spaces:** after a successful removal it closes every space that was in the worktree. If removal fails, nothing is closed.
- **Approvals:** unapproved project hooks are listed the same way as in the create dialog, with an **Approve and remove** button.
- **Not included:** processes a `post-start` hook started (a dev server) keep running unless a `post-remove` hook stops them.

Both mods work with spaces on remote Herdr machines: `git` and `wt` run on that machine.

## Requirements

- The Herdr desktop app (herdr-gui).
- `wt` and `git` on your `PATH`, and on any remote machine whose spaces you use them in.

## Install

### With an agent

Ask your coding agent to install the mods from this repo. Herdr's own
instructions (`~/.config/herdr-app/AGENTS.md`) tell the agent to copy each
folder under `mods/` into `~/.config/herdr-app/mods/`, merge this repo's
`keys.json` into yours (asking before replacing a key you already use), and
run `herdr-app check` on each mod.

### By hand

1. Copy or symlink the mods into Herdr's mods folder:

   ```sh
   # copy
   cp -R mods/worktrunk-create mods/worktrunk-delete ~/.config/herdr-app/mods/

   # or symlink, so `git pull` updates them
   ln -s "$PWD/mods/worktrunk-create" ~/.config/herdr-app/mods/worktrunk-create
   ln -s "$PWD/mods/worktrunk-delete" ~/.config/herdr-app/mods/worktrunk-delete
   ```

2. Check that they load:

   ```sh
   herdr-app check ~/.config/herdr-app/mods/worktrunk-create
   herdr-app check ~/.config/herdr-app/mods/worktrunk-delete
   ```

3. Add the key bindings (below).

## Key bindings

Herdr doesn't install a mod's keys by itself. Add these lines to the
`"global"` section of `~/.config/herdr-app/keys.json`, one for each mod you
installed:

```json
"cmd-shift-n": "mod.open:worktrunk-create",
"cmd-shift-backspace": "mod.open:worktrunk-delete",
```

Herdr applies the change immediately. If a key doesn't work,
`~/.config/herdr-app/keys.error` says why. To use different keys, change
`cmd-shift-n` or `cmd-shift-backspace`; anything not already in your
`keys.json` works.

Editing `keys.json` makes the whole file yours: Herdr stops adding new default
shortcuts to it on upgrade, so you add those by hand from then on.

You can also open the dialogs without key bindings:

```sh
herdr-app do mod.open --name worktrunk-create
herdr-app do mod.open --name worktrunk-delete
```

## Uninstall

Delete `~/.config/herdr-app/mods/worktrunk-create` and
`~/.config/herdr-app/mods/worktrunk-delete`, and remove their `mod.open` lines
from your `keys.json`.

## Development

Herdr writes `jsconfig.json` and `gpui-kit.d.ts` into a mod folder for editor
support (including when you run `herdr-app check` here). They're gitignored.
