# Development Data

Formal DEVD installations use the active directory resolved in this order:

1. `TUCKMARK_DATA_DIR`
2. the path saved by DEVD in the platform `devd.json`
3. the user's `Documents/Tuckmark` directory

Development must not run directly against that formal directory. Prepare an
isolated test copy explicitly when realistic local data is useful:

```bash
bun run dev:data:prepare
```

The command resolves the source using the same order, copies only
`manifest.json`, `settings`, `templates`, `drafts`, and `inventory`, validates
the copied file counts, and atomically installs it under
`${TMPDIR}/tuckmark-devd-dev/<worktree-path-hash8>/data`. Backups, ownership
markers, live locks, transaction control files, and Agent sessions are not
copied.

An existing valid copy from the same source is reused. It is not copied again.
Use an explicit source or rebuild the copy only when needed:

```bash
bun run dev:data:prepare -- --source /absolute/path/to/Tuckmark
bun run dev:data:prepare -- --refresh
```

`bun run dev:preview` uses the prepared copy when it is valid. Otherwise it
starts with a new empty temporary directory; it never copies formal data on its
own. The default development instance is `dev-<worktree-path-hash8>`, so
multiple worktrees can run independently. `TUCKMARK_DEVD_INSTANCE` and
`TUCKMARK_DATA_DIR` remain explicit development overrides.
