---
name: tuckmark-templates-source
description: Exercise the Tuckmark template management workflow through the active source checkout without accidentally invoking a globally installed release CLI.
---

# Tuckmark Templates Source

Use this skill inside a Tuckmark source checkout. Read and follow `../tuckmark-templates/SKILL.md` first. If it is unavailable, stop.

## Source Guard

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
test -f "$REPO_ROOT/packages/cli/src/index.ts"
```

Never substitute a globally installed `tuckmark` binary while validating the active worktree.

## Source Executor

Replace each leading `tuckmark` command in the main skill with:

```bash
bun tsx --tsconfig "$REPO_ROOT/packages/cli/tsconfig.typecheck.json" "$REPO_ROOT/packages/cli/src/index.ts"
```

Keep the active worktree's DEVD isolation contract. Do not target formal user data while testing source behavior.

## Focused Checks

- `bun run --filter @tuckmark/core test`
- `bun run --filter @tuckmark/server test`
- `bun run --filter @tuckmark/cli test`
- Matching package typechecks
