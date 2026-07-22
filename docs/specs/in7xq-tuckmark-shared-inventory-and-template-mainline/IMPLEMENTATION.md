# Implementation Notes

## Current coverage

- Workspace packaging now includes `plugins/*`, and `plugins/inventory` is a
  first-class workspace package exported as `@tuckmark/inventory`.
- `plugins/inventory` owns the shared domain contract for:
  - inventory material schema
  - inventory adjustment schema
  - template binding schema
  - quantity reconciliation and non-negative stock rules
  - print field assembly and mapping fallback
  - deletion / archive guards
- `apps/web/src/data-directory-service.ts` exposes reusable data-directory
  file helpers for runtime snapshot reads, writes, listing, and deletion.
- `apps/web/src/user-template-store.ts` now resolves a configured
  data-directory template store before the legacy browser-local migration
  source.
- `apps/web/src/inventory-data-store.ts` implements data-directory CRUD for:
  - materials
  - adjustments
  - stock reconciliation
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
- `apps/web/src/inventory-page.stories.tsx` covers directory-required, empty,
  populated, edit/bind, and adjust/print inventory states for review capture.
- `packages/cli/src/shared-data-directory.ts` implements:
  - saved CLI config at `~/.config/tuckmark/config.json`
  - data-directory resolution
  - user-template lifecycle operations
  - inventory CRUD and adjustment flows
  - inventory print-source resolution across system templates and user
    templates
  - user-template package import into the directory-backed user-template store
- `packages/cli/src/index.ts` now exposes:
  - `config get-data-dir`
  - `config set-data-dir`
  - `template` lifecycle commands
  - `inventory` command family
  - legacy read-only `templates` compatibility listing

## Validation

- `bun run test` in `plugins/inventory`
- `bun run test -- src/cli.test.ts` in `packages/cli`
- `bun x tsc -p packages/cli/tsconfig.typecheck.json --pretty false`
- `bun run test -- src/workbench-route-registry.test.ts` in `apps/web`

## Notes

- User-template migration into the data-directory-backed store is intentionally
  one-way in product semantics:
  browser-local legacy data is only a bootstrap source for the new mainline.
- CLI and Web reuse the same JSON tree but do not attempt concurrent file-level
  merges beyond the existing latest-wins directory semantics.
- Inventory v1 deliberately stores only total stock; deeper warehouse modeling
  remains out of scope for this topic.
