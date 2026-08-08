# Tuckmark Inventory and Data-Directory Mainline

- Spec ID: `in7xq`
- Status: `active`
- Owner: `Codex`

## Summary

Tuckmark keeps browser-static user templates and inventory local to the browser.
In `server-http`, DEVD owns the resolved active data directory and is the sole
business-data authority. Web uses HTTP resource commands; CLI and installed
native tools use named IPC instances. It does not define a separate "shared
template" category: user templates remain the same "我的模板" records.

Production CLI and DEVD behavior is implemented only in Rust. TypeScript CLI
or server source retained during migration is reference material, not a second
production runtime or data authority.

This round also introduces `/inventory` as a top-level workbench route and
`plugins/inventory` as the shared domain boundary for material records, stock
adjustments, template bindings, and print-input assembly. Dynamic third-party
plugin discovery remains out of scope; the plugin boundary is modular but
built-in.

## Requirements

### Data-directory contract

- In `server-http`, DEVD always resolves and exclusively owns one active data
  directory for:
  - user templates
  - user-template versions and working copies
  - inventory materials
  - inventory adjustments
- The configured directory is a versioned JSON tree rooted at:
  - `manifest.json`
  - `settings/app-settings.json`
  - `templates/<templateId>/template.json`
  - `templates/<templateId>/versions/<versionId>.json`
  - `templates/<templateId>/working-copy.json`
  - `inventory/materials/<materialId>.json`
  - `inventory/adjustments/<adjustmentId>.json`
  - `inventory/transactions/<adjustmentId>.json` only while an adjustment
    transaction awaits recovery
  - `drafts/scratch/<presetId>.json`
  - `drafts/preset-template/<presetId>.json`
  - `backups/manual/*.zip`
  - `backups/protection/*.zip`
- `manifest.json` records schema version, timestamps, source metadata, and
  aggregate counts for the current runtime and inventory snapshot: templates,
  versions, working copies, materials, and adjustments.
- Inventory material and adjustment records are versioned by their own JSON
  schemas under `inventory/`; `/system` runtime ZIP backup, restore, import,
  and export include the inventory snapshot alongside the runtime templates.
- An adjustment first records a recoverable transaction, then writes the
  material cache and audit record. Readers replay pending transactions before
  serving inventory data; system sync, backup, and export also replay them
  before capturing the inventory snapshot.
- Routine runtime-template synchronization preserves the existing
  `inventory/` subtree. Only an explicit attach initialization, archive import,
  backup restore, or data-directory switch replaces that subtree.
- Formal DEVD data-directory resolution is, in descending priority:
  - explicit `TUCKMARK_DATA_DIR`, which applies only to the current process and
    is never persisted
  - the path saved in the platform configuration directory's `devd.json`
  - the user's system Documents directory plus `Tuckmark`
- The formal default is `~/Documents/Tuckmark` on macOS, the system My
  Documents directory plus `Tuckmark` on Windows, and the XDG Documents
  directory plus `Tuckmark` on Linux with `~/Documents/Tuckmark` as fallback.
- DEVD stores schema `tuckmark.devd-config.v1` in:
  - macOS: `~/Library/Application Support/Tuckmark/devd.json`
  - Windows: `%APPDATA%/Tuckmark/devd.json`
  - Linux: `${XDG_CONFIG_HOME:-~/.config}/tuckmark/devd.json`
- On first formal startup without an environment override or saved config,
  DEVD creates the default directory and atomically saves it. The retired CLI
  config at `~/.config/tuckmark/config.json` is ignored and not migrated.
- Data-directory changes are DEVD operations. A saved change takes effect after
  restart, does not move existing data, creates an absent target, and rejects a
  non-empty target that is not a recognized Tuckmark data directory.
- `browser-static` retains its browser-local user templates and inventory and
  does not use the formal DEVD directory contract.
- CLI does not resolve or open a data directory. It requires `--instance` or
  `TUCKMARK_DEVD_INSTANCE` and sends data commands through DEVD IPC. Legacy
  `--data-dir`, `--devd-url`, and `TUCKMARK_DEVD_URL` values return a migration
  error without fallback.
- DEVD may expose HTTP and named IPC listeners for the same app. macOS/Linux
  use Unix sockets and Windows uses Named Pipes; instance names are explicit so
  multiple development projects can run concurrently.

### Compatibility authority

- `compatibility/manifest.v1.json` normatively inventories all CLI commands and
  flags, the 50 HTTP/SSE routes, status/error/exit behavior, named IPC rules,
  and persisted `tuckmark.*.v1` shapes.
- Nine synthetic golden fixture categories cover CLI output, HTTP, SSE, data
  trees, interrupted transactions, archives, decoded rendering, print packets,
  and release artifacts without using real user data.
- `test:contracts` validates those assets without importing TypeScript CLI or
  server modules and remains runnable after those sources are removed.
- The Rust migration makes no persisted schema change. Existing schema names,
  shapes, paths, archive layouts, recovery semantics, render output, and packet
  bytes remain compatible. Schema evolution requires a separate approved Spec
  and migration contract.

### Material and stock contract

- Inventory v1 stores only one total quantity per material.
- Material records include:
  - stable `id`
  - `fullName`
  - optional `primaryName`
  - optional `secondaryName`
  - optional `packageName`
  - optional `description`
  - optional `packagingRemark`
  - optional `matrixCode`
  - `currentQuantity`
  - archive metadata
  - template bindings
- `fullName` is the unique business key.
- Non-empty `matrixCode` values are globally unique.
- `currentQuantity` is a non-negative integer.
- A material can bind to one or more templates. Each binding stores:
  - template source and template identifier
  - default print quantity
  - optional field mapping overrides
- Adjustment records are append-only and include:
  - stable `id`
  - `materialId`
  - `type` as `in`, `out`, or `correction`
  - `quantityDelta` for `in` and `out`
  - `targetQuantity` plus derived delta for `correction`
  - optional note
  - actor / source metadata
  - timestamp
- No operation may drive `currentQuantity` below `0`.
- Materials with adjustment history may be archived but not hard-deleted.
- Materials without adjustment history may be deleted permanently.

### Template source and print contract

- The selectable template pool for inventory workflows is:
  - built-in system templates
  - user templates from the active Web store: browser-local by default, or the
    configured directory when attached
- `/canvas` remains the only WYSIWYG template editor.
- CLI template lifecycle management covers user templates exposed by the
  selected DEVD instance.
- System templates remain read-only in CLI and Web lifecycle operations.
- The legacy flat `templates` CLI command remains as a read-only compatibility
  alias for system templates.
- Inventory manual print lets the user:
  - pick one bound template
  - start from the binding's default quantity and field mapping
  - override the print quantity for the current print action
- The material `quantity` and `currentQuantity` fields always represent total
  inventory. The one-off print quantity only controls dispatched print jobs.
- Binding default print quantity is only a manual-print preset in v1. It does
  not auto-trigger on stock movements.
- Field filling defaults to same-name matching and allows per-binding override
  mappings.
- Inventory manual print is an IPC command handled by DEVD: it resolves the
  binding, compiles the authoritative system or user-template document, and
  controls the printer under the existing server-side print gate. No CLI file
  or HTTP fallback is introduced.

### Web contract

- Header navigation adds a top-level `库存` entry at `/inventory`.
- `/inventory` is route-preloaded the same way as the other formal workbench
  routes.
- The desktop route-owned layout is:
  - left: list
  - center: detail and template bindings
  - right: stock and print
- At `960-1279px`, the material list stays visible and the right side switches
  between `物料与标签` and `库存与打印`.
- `/inventory` supports these owner-facing states:
  - browser-local empty inventory
  - configured but empty inventory
  - material list with stock summary
  - material edit and template binding
  - stock adjustment and manual print
- `/system` copy and semantics describe the configured directory as an
  optional unified data location instead of a backup-only mirror.

### CLI contract

- `config get-data-dir --instance <name>` returns the active, saved, and default
  paths, resolution source, config path, and restart state through IPC.
- `config set-data-dir --path <dir> --instance <name>` resolves the input to an
  absolute path and asks DEVD to validate and persist it through IPC. CLI never
  opens the path, migrates data, or uses HTTP fallback.
- `template` commands cover:
  - `list`
  - `show`
  - `import`
  - `rename`
  - `archive`
  - `restore`
  - `delete`
- `inventory` commands cover:
  - `list`
  - `show`
  - `create`
  - `update`
  - `archive`
  - `restore`
  - `delete`
  - `adjust`
  - `print`
- Template, inventory, Agent Import, print, and configuration commands require
  a named DEVD instance and never access business data files directly.
- CLI does not provide canvas editing. It only manages template
  lifecycle, preview/print compilation, and inventory operations.

### Migration and compatibility contract

- Browser-local user-template and inventory data remains the persistence
  surface for `browser-static`; it is not silently migrated into formal DEVD.
- Legacy `--data-dir`, data-directory CLI config inputs, `--devd-url`, and
  `TUCKMARK_DEVD_URL` return migration guidance without direct access or HTTP
  fallback.
- Development data is isolated from the formal directory. An explicit prepare
  command resolves the formal source, then copies only `manifest.json`,
  `settings`, `templates`, `drafts`, and `inventory` into
  `${TMPDIR}/tuckmark-devd-dev/<repo-path-hash8>/data` using staging,
  manifest/file-count validation, and atomic replacement. It excludes backups,
  ownership and transaction control files, live locks, and Agent sessions.
- A valid prepared copy from the same source is reused unless `--refresh` is
  requested. Development preview uses that copy when present, otherwise starts
  with an empty temporary directory; it never copies formal data implicitly.
- The default development instance is derived from the absolute worktree path,
  while `TUCKMARK_DEVD_INSTANCE` remains an explicit override.
- This round does not include:
  - automatic print on stock movement
  - camera scanning or fuzzy matrix-code recognition
  - CSV import/export
  - vendor, location, batch, or serial-number inventory dimensions
  - general plugin discovery and installation

## Acceptance

- With the resolved `server-http` data directory, Web `/templates`, `/canvas`,
  `/inventory`, and CLI `template` / `inventory` commands all read and write
  the same template and material records.
- First formal startup creates and saves `Documents/Tuckmark`; environment,
  saved-config, and default precedence is deterministic on all platforms.
- Two worktrees derive different development instances and temporary data
  locations. Preparing an existing valid copy is a no-op, while `--refresh`
  validates and atomically replaces it without copying control or backup data.
- CLI mutations become visible in Web after refresh, and Web mutations become
  visible to CLI without extra conversion steps.
- In `browser-static`, Web `/templates`, `/canvas`, and `/inventory` remain
  available through browser-local runtime storage without a browser-authorized
  directory. Native CLI commands remain bound to a named formal DEVD instance.
- Material CRUD enforces:
  - unique `fullName`
  - globally unique non-empty `matrixCode`
  - non-negative integer `currentQuantity`
  - optional `packagingRemark`
- Adjustment flows enforce:
  - append-only audit records
  - cache refresh of `currentQuantity`
  - no negative post-adjustment stock
  - `correction` using an absolute target quantity while preserving derived
    delta
- Manual inventory print supports both system-template and user-template
  bindings, starts from saved mapping defaults, and still allows one-off print
  quantity override. A positive manual quantity produces that many print jobs
  or browser-direct packet copies.
- Storybook covers at least:
  - browser-local empty inventory
  - configured empty inventory
  - populated inventory list
  - material edit and template bindings
  - stock adjustment and manual print

## Visual Evidence

- `1753×1225` `/inventory` browser-local empty state. The page has no
  data-directory setup prompt; it keeps search above the compact summary stack
  and the material list in the primary column.

  PR: include
  ![Inventory browser-local empty state](./assets/inventory-browser-local-empty-1753x1225.png)
