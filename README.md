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

By default, the core adapter runs a Rust preview helper for packet generation and `cargo run -q -p detonger -- ...` for scan/print commands with `cwd=./detonger`.
You can still override this with `TUCKMARK_DETONGER_COMMAND` or `TUCKMARK_DETONGER_REPO_ROOT`.

## Workspace

- `packages/core`: shared domain logic, rendering, artifact storage, and detonger integration
- `packages/server`: HTTP API
- `packages/cli`: command-line interface
- `packages/mcp`: MCP server
- `apps/web`: Web UI

## Local Preview

### Recommended startup path

Use `bun run dev:preview` for normal product development.

This is the default developer entrypoint because it starts:

- the HTTP API from `packages/server`
- the Vite Web dev server from `apps/web`
- the matching `/api` proxy wiring between them

Default URLs:

- Web UI: `http://127.0.0.1:5173/`
- API health: `http://127.0.0.1:5210/health`

### When to use each command

- `bun run dev:preview`
  - use for normal Web app development
  - use when the page needs the runtime `/api`
  - use when you want Vite HMR together with the real local server flow
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
