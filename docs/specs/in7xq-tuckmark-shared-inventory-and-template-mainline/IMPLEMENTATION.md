# Implementation Notes

## Current coverage

- Workspace packaging now includes `plugins/*`, and `plugins/inventory` is a
  first-class workspace package exported as `@tuckmark/inventory`.
- `plugins/inventory` owns the shared domain contract for:
  - inventory material schema
  - inventory adjustment schema
  - recoverable inventory-adjustment transaction schema
  - template binding schema
  - quantity reconciliation and non-negative stock rules
  - print field assembly and mapping fallback
  - deletion / archive guards
- `apps/web/src/data-directory-service.ts` exposes reusable data-directory
  file helpers for runtime snapshot reads, writes, listing, and deletion. Its
  routine template synchronization preserves the directory inventory subtree,
  while explicit initialization, import, and restore replace it deliberately.
  System sync, backup, and export recover pending inventory transactions before
  reading their snapshot.
- `apps/web/src/inventory-browser-storage.ts` centralizes the browser-local
  inventory snapshot so archive import and export retain inventory when no
  data directory is attached.
- `apps/web/src/user-template-store.ts` uses the configured directory when one
  is attached and otherwise keeps user templates in the browser-local runtime
  store.
- `apps/web/src/inventory-data-store.ts` implements browser-local and optional
  data-directory CRUD for:
  - materials
  - adjustments
  - stock reconciliation
  - replay of pending adjustment transactions before reads and mutations
  - archive / restore / delete
- `apps/web/src/workbench-inventory-route.tsx` implements the routed inventory
  workbench with:
  - search and selection
  - material create / update
  - template binding management
  - stock adjustment
  - manual print through the existing print seam
  - recent adjustment review
- `apps/web/src/workbench-app.tsx` and
  `apps/web/src/workbench-route-registry.tsx` add `/inventory` to top-level
  navigation, deferred route loading, and route preload behavior.
- `apps/web/src/system-data-storage-card.tsx` now describes the directory as
  an optional unified data location instead of a backup-only mirror.
- `apps/web/src/inventory-page.stories.tsx` covers browser-local empty,
  configured empty, populated, edit/bind, and adjust/print inventory states
  for review capture.
- `packages/cli/src/devd-ipc-client.ts` implements the CLI's named IPC client:
  - required explicit instance resolution
  - HTTP-shaped revisioned runtime and inventory requests
  - Agent Import session requests with instance credentials
  - DEVD-owned inventory print requests
- `packages/server/src/devd-data-service.ts` remains the sole file-backed
  runtime owner. Its template metadata patch keeps saved-version history
  stable, synchronizes user working copies, and rejects stale revisions.
- `packages/server/src/devd-config.ts` resolves the formal platform default,
  reads and atomically writes `tuckmark.devd-config.v1`, applies environment,
  saved, and default precedence, and validates directory switches. The shared
  Express app exposes this service to Web HTTP and named IPC clients without
  giving CLI any filesystem ownership.
- `packages/ipc` implements per-user Unix socket / Named Pipe endpoint
  resolution, validation, stale Unix socket recovery, and endpoint occupancy
  errors for named development instances.
- `scripts/dev-data.ts` prepares a validated, worktree-specific temporary copy
  of current business data. `scripts/dev-preview.ts` reuses only a valid
  prepared copy, otherwise creates an empty disposable directory, and derives
  its default instance from the absolute worktree path.
- `packages/cli/src/index.ts` exposes:
  - DEVD-backed `config get-data-dir` and `config set-data-dir`
  - named `TUCKMARK_DEVD_INSTANCE` IPC startup
  - `template` lifecycle commands
  - `inventory` command family
  - legacy read-only `templates` compatibility listing

## Validation

- `bun run check` at the repository root
- `bun x playwright test tests/inventory-print-preview.spec.ts` in `apps/web`
  with the preview server lease injected through `TUCKMARK_E2E_PORT`; it
  creates a material, binds a template, changes the manual quantity to `2`,
  and generates the print preview.

## Notes

- Formal `server-http` startup always resolves one DEVD-owned directory.
  `browser-static` keeps its independent browser-local persistence surface.
- CLI and Web reuse the same JSON tree but do not attempt concurrent file-level
  merges beyond the existing latest-wins directory semantics. Runtime-template
  writes intentionally leave inventory files alone so those writes cannot erase
  stock changed by another surface.
- Inventory v1 deliberately stores only total stock; deeper warehouse modeling
  remains out of scope for this topic.

## Compatibility mapping

- `compatibility/manifest.v1.json` freezes 36 CLI commands, 50 HTTP/SSE routes,
  named IPC rules, and persisted `tuckmark.*.v1` shapes at the implementation
  replacement boundary.
- The data-tree, interrupted-transaction, and archive fixtures exercise DEVD's
  single-writer directory ownership without importing TypeScript CLI or server
  modules.
- The root `test:contracts` command is part of normal workspace CI and remains
  independently runnable when the reference TypeScript runtime is removed.
