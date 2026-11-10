# conductor-worktrunk

Worktrunk plugin for herdr-gui: create git worktrees with
[worktrunk](https://worktrunk.dev) (`wt`) from a Herdr dialog.

## What's here

| Path | What it is |
|---|---|
| `mods/worktrunk-create/` | **New worktree** dialog. Type a branch name; it runs `wt switch [--create] <branch> --no-cd` in the focused space's repo and opens the new worktree as a space. |
| `keys.json` | The key binding the mod expects: `cmd-shift-n` opens the dialog. |

How `worktrunk-create` behaves:

- **Location:** worktrunk's `worktree-path` setting decides where the worktree goes.
- **Branches:** a new branch starts from the default branch; an existing branch is checked out into a new worktree.
- **Hooks:** `pre-start` hooks run while the dialog waits; `post-start` and `post-switch` hooks run in the background, as worktrunk normally runs them. If a hook fails after the worktree exists, the space still opens and a warning notification shows.
- **Approvals:** worktrunk can't prompt inside a dialog. If the project has hooks you haven't approved, the dialog lists the commands and runs nothing until you click **Approve and create**, which saves the approval like `wt config approvals add`.
- **Already open:** if the worktree already has a space, it switches to that space.
- **Other machines:** for a space on a remote Herdr machine, `git` and `wt` run on that machine.

## Requirements

- The Herdr desktop app (herdr-gui).
- `wt` and `git` on your `PATH`, and on any remote machine whose spaces you use it in.

## Install

### With an agent

Ask your coding agent to install this mod from this repo. Herdr's own
instructions (`~/.config/herdr-app/AGENTS.md`) tell the agent to copy
`mods/worktrunk-create/` into `~/.config/herdr-app/mods/`, merge this repo's
`keys.json` into yours (asking before replacing a key you already use), and
run `herdr-app check` on the mod.

### By hand

1. Copy or symlink the mod into Herdr's mods folder:

   ```sh
   # copy
   cp -R mods/worktrunk-create ~/.config/herdr-app/mods/

   # or symlink, so `git pull` updates it
   ln -s "$PWD/mods/worktrunk-create" ~/.config/herdr-app/mods/worktrunk-create
   ```

2. Check that it loads:

   ```sh
   herdr-app check ~/.config/herdr-app/mods/worktrunk-create
   ```

3. Add the key binding (below).

## Key binding

Herdr doesn't install a mod's keys by itself. Add this line to the `"global"`
section of `~/.config/herdr-app/keys.json`:

```json
"cmd-shift-n": "mod.open:worktrunk-create",
```

Herdr applies the change immediately. If the key doesn't work,
`~/.config/herdr-app/keys.error` says why. To use a different key, change
`cmd-shift-n`; anything not already in your `keys.json` works.

Editing `keys.json` makes the whole file yours: Herdr stops adding new default
shortcuts to it on upgrade, so you add those by hand from then on.

You can also open the dialog without a key binding:

```sh
herdr-app do mod.open --name worktrunk-create
```

## Uninstall

Delete `~/.config/herdr-app/mods/worktrunk-create` and remove the
`mod.open:worktrunk-create` line from your `keys.json`.

## Development

Herdr writes `jsconfig.json` and `gpui-kit.d.ts` into a mod folder for editor
support (including when you run `herdr-app check` here). They're gitignored.
