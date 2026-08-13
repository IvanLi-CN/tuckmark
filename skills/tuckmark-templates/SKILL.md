---
name: tuckmark-templates
description: Manage Tuckmark templates through the released CLI and its DEVD-backed lifecycle, including creation, editing, validation, preview, history, archive, restore, and explicitly authorized printing.
---

# Tuckmark Templates

Use the released `tuckmark` CLI. The CLI delegates managed template operations to DEVD; do not read or write DEVD data files directly.

## Safety

- Do not physically print unless the owner explicitly authorizes that print operation.
- Do not permanently delete templates. Archive is the normal removal path.
- Do not edit system templates in place. Export one, change its `id` and `name`, validate it, then import it as a user template.
- Preserve unrelated fields and array order when editing exported JSON.
- Never bypass CLI/DEVD revision or edit-baseline conflicts.

## Discover And Inspect

- List: `tuckmark template list`
- Show one template: `tuckmark template show --id <id>`
- List saved versions: `tuckmark template versions --id <id>`
- Include autosaves only when needed: `tuckmark template versions --id <id> --include-autosaves`

## Create

1. Write a `tuckmark.user-template-package.v1` JSON file without `editBaseline`.
2. Validate: `tuckmark template-package validate --file <template.json>`.
3. Preview: `tuckmark template-package preview --file <template.json>` and require a non-empty preview artifact.
4. Import: `tuckmark template import --file <template.json>`.

## Edit Content

1. Export the current user template: `tuckmark template export --id <id> --file <template.json>`.
2. Edit only the requested content. Keep `editBaseline` and `editor` intact.
3. Run `template-package validate` and `template-package preview`; require a non-empty preview artifact.
4. Update: `tuckmark template import --file <template.json> --update`.
5. If DEVD reports that the template changed after export, export again and merge. Never discard the newer state.

Exports do not overwrite existing files unless `--overwrite` is explicitly supplied. Without `--file`, export writes stable JSON to stdout.

## Metadata And Lifecycle

- Metadata: `tuckmark template update --id <id> [--name <name>] [--description <text>] [--recommended-use <text>]`.
- Rename: `tuckmark template rename --id <id> --name <name>`.
- Archive: `tuckmark template archive --id <id>`.
- Restore archived template: `tuckmark template restore --id <id>`.

Metadata-only and archive/restore operations do not require a preview.

## History

- Export one immutable historical version: `tuckmark template export --id <id> --version <version-id> --file <template.json>`.
- Historical exports do not contain `editBaseline` and cannot be used with `import --update`.
- Restore history explicitly: `tuckmark template restore-version --id <id> --version <version-id>`.
- Restore creates a new saved version and preserves existing history. Autosaves are valid restore sources.

## Render And Print

- Validate: `tuckmark template-package validate --file <template.json>`.
- Preview: `tuckmark template-package preview --file <template.json>`.
- Generate packets: `tuckmark template-package packets --file <template.json>`.
- After explicit owner approval only: `TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 tuckmark template-package print --printer <id> --file <template.json>`.
