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

- Run `bun run dev:preview` to start the HTTP API and the Web UI with a matched proxy configuration.
- Default URLs:
  - Web UI: `http://127.0.0.1:5173/`
  - API health: `http://127.0.0.1:5210/health`
- Override ports with:
  - `TUCKMARK_SERVER_PORT`
  - `TUCKMARK_WEB_PORT`
  - `TUCKMARK_API_ORIGIN`

## Web Print Path

- The Web UI renders previews on the server.
- Physical printing from the Web UI can use either:
  - a backend-discovered printer through the server print API
  - a real Chrome browser with Web Bluetooth support
- Both preview and print continue to share the same render artifact.
