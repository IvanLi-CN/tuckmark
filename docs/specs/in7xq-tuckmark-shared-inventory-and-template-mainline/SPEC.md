# Tuckmark Inventory and Data-Directory Mainline

- Spec ID: `in7xq`
- Status: `active`
- Owner: `Codex`

## Summary

Tuckmark adds a configurable data-directory path that Web, CLI, and installed
PWA can point at when they need to share one versioned JSON tree for user
templates and inventory. When that directory is not configured, Web user
templates continue to work through the browser-local runtime store.

This round also introduces `/inventory` as a top-level workbench route and
`plugins/inventory` as the shared domain boundary for material records, stock
adjustments, template bindings, and print-input assembly. Dynamic third-party
plugin discovery remains out of scope; the plugin boundary is modular but
built-in.

## Requirements

### Data-directory contract

- A configured data directory is the cross-surface persistence surface for:
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
  - `drafts/scratch/<presetId>.json`
  - `drafts/preset-template/<presetId>.json`
  - `backups/manual/*.zip`
  - `backups/protection/*.zip`
- `manifest.json` records schema version, timestamps, source metadata, and
  aggregate counts for the current runtime template snapshot: templates,
  versions, and working copies.
- Inventory material and adjustment records are versioned by their own JSON
  schemas under `inventory/`; current `/system` runtime ZIP backup / restore
  does not include inventory records.
- Web `/system` owns data-directory attach, switch, migration, backup,
  restore, import, and export flows for the runtime template snapshot.
- CLI resolves the directory in this priority order:
  - `--data-dir`
  - saved default directory
  - explicit error
- Tuckmark does not introduce a background helper or daemon in this round.

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
  - user templates from the configured directory
- `/canvas` remains the only WYSIWYG template editor.
- CLI template lifecycle management covers user templates stored in the
  configured directory.
- System templates remain read-only in CLI and Web lifecycle operations.
- The legacy flat `templates` CLI command remains as a read-only compatibility
  alias for system templates.
- Inventory manual print lets the user:
  - pick one bound template
  - start from the binding's default quantity and field mapping
  - override the print quantity for the current print action
- Binding default print quantity is only a manual-print preset in v1. It does
  not auto-trigger on stock movements.
- Field filling defaults to same-name matching and allows per-binding override
  mappings.
- Inventory manual print reuses the existing `browser-direct` and
  `service-api` artifact seam. No third print path is introduced.

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
  - directory required
  - configured but empty
  - material list with stock summary
  - material edit and template binding
  - stock adjustment and manual print
- `/system` copy and semantics describe the configured directory as an
  optional unified data location instead of a backup-only mirror.

### CLI contract

- `config get-data-dir` prints the effective saved default directory.
- `config set-data-dir --path <dir>` persists the default directory.
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
- Template and inventory commands fail with a clear data-directory error
  when no directory can be resolved.
- CLI does not provide canvas editing. It only manages template
  lifecycle, preview/print compilation, and inventory operations.

### Migration and compatibility contract

- Legacy browser-local user-template data is a one-time migration input, not a
  continuing truth source.
- Attaching a configured directory can initialize from migrated runtime data or
  import an existing Tuckmark directory.
- Without a configured directory:
  - built-in system templates remain usable
  - Web `/templates` and `/canvas` remain usable through browser-local runtime
    storage
  - existing preview / print flows remain usable
  - Web `/inventory` stays unavailable with explicit directory guidance
  - CLI `template` / `inventory` commands stay unavailable until a directory
    is resolved
- This round does not include:
  - automatic print on stock movement
  - camera scanning or fuzzy matrix-code recognition
  - CSV import/export
  - vendor, location, batch, or serial-number inventory dimensions
  - general plugin discovery and installation

## Acceptance

- With a configured data directory, Web `/templates`, `/canvas`,
  `/inventory`, and CLI `template` / `inventory` commands all read and write
  the same template and material records.
- CLI mutations become visible in Web after refresh, and Web mutations become
  visible to CLI without extra conversion steps.
- Without a configured directory, Web `/templates` and `/canvas` remain
  available through browser-local runtime storage, while Web `/inventory` and
  CLI `template` / `inventory` commands surface directory guidance.
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
  quantity override.
- Storybook covers at least:
  - directory required
  - configured empty inventory
  - populated inventory list
  - material edit and template bindings
  - stock adjustment and manual print

## Visual Evidence

- `1600×1200` `/inventory` directory-required state

  PR: include
  ![Inventory page directory required](./assets/inventory-directory-required-1600x1200.png)

- `1600×1200` `/inventory` material edit and template-binding state

  PR: include
  ![Inventory page material and bindings](./assets/inventory-material-edit-1600x1200.png)

- `1600×1200` `/inventory` stock adjustment and manual print state

  PR: include
  ![Inventory page adjust and print](./assets/inventory-adjust-print-1600x1200.png)
