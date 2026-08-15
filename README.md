# Tuckmark

Tuckmark is an agent-native label printing workspace.

It sits above `detonger` and provides a shared model for:

- printer discovery and capabilities
- template rendering and preview
- batch preview from structured inputs
- direct bitmap printing
- CLI, MCP, HTTP, and Web surfaces

## Detonger Submodule

`detonger` is tracked as a git submodule at `./detonger`.

Clone or sync with:

- `git submodule update --init --recursive`

In a source checkout, the core adapter uses the local Rust preview helper and
`cargo run -q -p detonger -- ...` for scan/print commands with `cwd=./detonger`.
Released host tools instead resolve their private detonger helpers next to the
installed executable, without requiring Cargo, a workspace, or a source checkout.
`TUCKMARK_DETONGER_COMMAND` remains an explicit diagnostic override.

## Released Host Tools

GitHub Releases publish standalone `tuckmark` and `tuckmark-devd` executables
for macOS arm64/x64, Linux x64, and Windows x64. Each archive also contains
private detonger helpers and the two released Agent Skills. The executables do
not require Node, Bun, `node_modules`, a workspace, or the current directory.

Tuckmark does not provide an installation script or modify PATH. Follow the
manual checksum, stable-path, and Skill installation instructions in
[Install Tuckmark Host Tools](docs/install.md).

## Workspace

- `packages/core`: shared domain logic, rendering, artifact storage, and detonger integration
- `packages/server`: HTTP API
- `packages/cli`: command-line interface
- `packages/mcp`: MCP server
- `apps/web`: Web UI
- `plugins/inventory`: inventory and data-directory template domain module

## Agent Template Packages

Agents can create fixed-size user template packages without calling an LLM from
Tuckmark itself. A package uses the `tuckmark.user-template-package.v1` schema,
declares a fixed mono canvas, fixed elements, fields, sample input, and render
options, then compiles to the same canvas artifact path used by direct printing.

Useful local source commands:

- `bun tsx --tsconfig packages/cli/tsconfig.typecheck.json packages/cli/src/index.ts template-package validate --file <package.json>`
- `bun tsx --tsconfig packages/cli/tsconfig.typecheck.json packages/cli/src/index.ts template-package preview --file <package.json>`
- `bun tsx --tsconfig packages/cli/tsconfig.typecheck.json packages/cli/src/index.ts template-package packets --file <package.json>`
- `TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1 bun tsx --tsconfig packages/cli/tsconfig.typecheck.json packages/cli/src/index.ts template-package print --printer <name> --file <package.json>`

The print command remains gated by `TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1` and
the existing printer capability checks. High-cost agent practice scripts only
generate packages, previews, packets, self-evaluation data, and HTML reports;
they do not contain a physical print path.

## Agent-Assisted Inventory Import

Tuckmark does not parse private order exports, host an LLM, or automate a browser.
An external Agent can interpret an order, optionally inspect an already-authorized
product page, then submit a `tuckmark.agent-import.v1` proposal to a DEVD
`server-http` instance that owns the shared local directory.

In `server-http`, DEVD exclusively owns templates, drafts, application settings, inventory, backups, and archive operations. Web requests use `/api/data` over HTTP; DEVD-owned native CLI and Agent Import requests use the named local IPC endpoint. macOS/Linux use a Unix socket and Windows uses a Named Pipe. Those DEVD-owned commands require `--instance <name>` or `TUCKMARK_DEVD_INSTANCE`; the instance name is never inferred from a data directory or URL. Both Web surfaces write the same `tuckmark.runtime-export-archive.v1` directory-tree ZIP: `archive.json` metadata, `manifest.json`, settings, template records and versions, working copies, materials, and adjustment records. Imports reject missing required files or manifest-count mismatches; previously downloaded `tuckmark.data-archive.v1` single-snapshot ZIP files remain importable.

Start DEVD with an explicit `TUCKMARK_DEVD_INSTANCE`. In formal environments,
DEVD resolves its data directory from `TUCKMARK_DATA_DIR`, its saved `devd.json`
configuration, or the user's `Documents/Tuckmark` directory, in that order.
The CLI never reads or writes the directory: `config get-data-dir` and
`config set-data-dir --path <dir>` use the named IPC instance and DEVD persists
changes. Legacy `--data-dir`, `--devd-url`, and `TUCKMARK_DEVD_URL` inputs return
a migration error without an HTTP fallback.

- `tuckmark agent-import catalog --instance <name>` lists system and shared-directory templates, including suggested scopes.
- `tuckmark agent-import inventory --instance <name>` lists active inventory for Agent identity decisions.
- `tuckmark agent-import create --file <proposal.json> --instance <name> [--web-url <url>]` opens the user confirmation page; `--no-open` supports headless Agents. `--web-url` selects the Web origin independently from the local IPC endpoint.
- `tuckmark agent-import wait` and `fulfill` use the instance stored in the credential file (or an explicit `--instance`) to handle field contracts after the user changes a new-material template.

User template lifecycle commands use the same named IPC boundary:
`template list`, `show`, `import`, `export`, `versions`, `restore-version`,
`update`, `rename`, `archive`, `restore`, and `delete`. Editable exports carry
a template-version and working-copy baseline; `import --update` rejects stale
exports. Historical exports are read-only, while `restore-version` creates a
new saved version without rewriting history. Metadata updates patch `name`, `description`, and
`recommendedUse` without creating a saved version; complete package imports
create a saved version. System templates are read-only, stale revisions fail
explicitly, and permanent deletes require the CLI command itself to target a
user template.

The MCP server does not accept or derive a DEVD address. Deployments inject an
authoritative template data service for `list`, `get`, package create/update,
metadata update, rename, archive, restore, and delete tools. The injected
service owns revision checks and filesystem access; permanent deletion requires
an explicit confirmation parameter.

The confirmation page keeps **new items** and **inventory restocks** separate. It
does not force a material-identity confirmation: uncertainty is a non-blocking
notice. Confirmed writes are performed by DEVD; new items create one material,
one label binding, and an inbound adjustment, while restocks write only an
inbound adjustment. Sessions use a fragment-held key and expire after 30 minutes.

Use `skills/tuckmark-agent-import` outside a source checkout and
`.agents/skills/tuckmark-agent-import-source` while testing the active worktree.
Use `skills/tuckmark-templates` for released CLI template management and
`.agents/skills/tuckmark-templates-source` to exercise the same contract
through the active source checkout.

Released Skills live under `skills/`; source-checkout Skills live under
`.agents/skills/` so Codex can discover them as project-level development
Skills.

## Local Preview

### Recommended startup path

Use `bun run dev:preview` for normal product development. It reuses a valid
worktree-specific prepared data copy when present and otherwise creates an empty
disposable directory. It never copies formal user data implicitly. Run
`bun run dev:data:prepare` explicitly when representative local test data is
needed; see [Development Data](docs/development.md).

This is the default developer entrypoint because it starts:

- the HTTP API from `packages/server`
- the Vite Web dev server from `apps/web`
- the matching `/api` proxy wiring between them

Default URLs:

- Web UI: `http://127.0.0.1:5173/`
- API health: `http://127.0.0.1:5210/health`
- Native DEVD instance: `dev-<worktree-hash8>` (override with `TUCKMARK_DEVD_INSTANCE`)

### When to use each command

- `bun run dev:preview`
  - use for normal Web app development
  - use when the page needs the runtime `/api`
  - use when you want Vite HMR together with the real local server flow
- `bun run dev:data:prepare [-- --refresh]`
  - copy the resolved formal dataset into the isolated development location
  - skip an existing valid copy unless `--refresh` is passed
- `bun run dev:web`
  - use only when you intentionally want the standalone Vite dev server
  - this does not start `packages/server`
  - `/api` requests will fail unless you start the server separately or point `TUCKMARK_API_ORIGIN` at a live runtime
- `bun run dev:server`
  - use when you only need the HTTP API process
- `bun run dev:storybook`
  - use for isolated component and fragment work
  - do not use this as the main product app development entrypoint
- `bun run preview:web:pages`
  - use only to verify the built static Pages bundle from `apps/web/dist`
  - do not use this for active Web development or HMR

### Configuration knobs

Override ports or runtime wiring with:

- `TUCKMARK_SERVER_PORT`
- `TUCKMARK_WEB_PORT`
- `TUCKMARK_API_ORIGIN`
- `TUCKMARK_DATA_DIR`
- `TUCKMARK_DEVD_INSTANCE`
- `TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT`
- `TUCKMARK_ENABLE_SERVER_SIDE_PRINT`

## Web Print Paths

- Tuckmark Web has two formal print paths with two separate switches.
- `browser-direct print path`
  - switch: `TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT`
  - intended environment: secure-context browsers with Web Bluetooth
  - behavior: the browser renders, encodes, and sends print data locally
  - does not depend on `/api/artifacts/:id/packets`
- `service-api print path`
  - switch: `TUCKMARK_ENABLE_SERVER_SIDE_PRINT`
  - intended environment: runtime `/api` backed by the service program and detonger
  - behavior: the Web app asks the runtime service API to control hardware
  - startup is fatal when enabled but detonger/runtime prerequisites are missing
- The two paths share artifact semantics, but not the same runtime dependency boundary.

## Session State Sync

- In `server-http`, the Web app performs same-device sync with the service for:
  - recent template usage
  - recent print history
  - preset-scoped canvas drafts
- The service persists merged session state in `.tuckmark/sync-state.json`.
- Browser and service state merge on startup and after draft save, draft reset, and successful print activity.
- Concurrent draft edits keep the merged winning draft plus conflict branch metadata instead of silently overwriting one side.
- `browser-static` and demo-style Web surfaces remain local-first and continue to work without the service runtime.

## Local Data Storage

- Tuckmark Web now keeps runtime state behind one storage boundary instead of scattering browser keys across page code.
- Supported Chromium desktop / installed-PWA surfaces prefer `SQLite Wasm + OPFS` for runtime-local drafts, recent activity, and migration state.
- In `server-http`, the active data directory is a DEVD-owned unified data location for user templates and inventory:
  - Web `/templates`, `/canvas`, `/inventory`, and `/system` use the DEVD HTTP resource API
  - CLI `template`, `inventory`, and Agent Import commands use named IPC instances
  - installed PWA and CLI share one dataset through DEVD without direct file access
- DEVD owns data-directory configuration and maintenance:
  - formal startup defaults to the user's `Documents/Tuckmark` directory
  - `devd.json` in the platform configuration directory stores the saved path
  - CLI configuration commands update that file through named IPC; a path change takes effect after restart and never migrates data automatically
  - initialize, import, or overwrite the versioned JSON tree through DEVD
  - create fixed-location runtime snapshot backups inside that directory
  - restore from a runtime backup ZIP
  - import or export the same runtime snapshot ZIP archive format
- `browser-static` remains independent and keeps user templates and inventory in browser-local runtime storage.
- Development previews use isolated temporary data and never default to the formal user directory.
- In `browser-static`, unsupported browsers keep local editing and inventory available through the compatibility storage path, while directory attach, backup / restore, and runtime import / export stay disabled with an explicit capability boundary.
