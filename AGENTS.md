# Agent notes

## Git remotes

- `origin` is the fork: `git@github.com:yunfan/porffor.git`
- `upstream` is the original project: `git@github.com:CanadaHonk/porffor.git`

## Keep local main synced with origin/main

Local `main` must always match `origin/main`, and track it.

- Before starting work, run `git fetch origin` and fast-forward local `main`.
- Right after pushing to `origin/main`, fast-forward local `main` again.
- Finished work belongs on `origin/main`, not only on a feature branch.
- Sync with `git -C <checkout of main> merge --ff-only origin/main`.
  `git worktree list` shows which checkout has `main`.
- Only fast-forward. If they have diverged, or the `main` checkout has
  uncommitted changes, stop and ask. Never reset or force-push `main`.
