# Tuckmark Design Notes

## Architecture Boundaries

Tuckmark is a Bun-first TypeScript workspace with one product-facing Web app and
multiple integration surfaces.

The Web app uses an explicit `ApiClient` boundary:

- `HttpApiClient` talks to the runtime `/api`
- `BrowserRuntimeApiClient` renders artifacts locally in the browser
- `DemoApiClient` serves the explicit Mock API demo contract

The UI must not encode transport-specific behavior directly into React
components. Runtime capabilities are resolved outside the presentational tree
and exposed as stable feature flags.

The owner-facing capability contract is expressed as two print paths:

- `browser-direct print path`
- `service-api print path`

The UI must not expose packet-helper details such as HTTP packet sources as
product capabilities.

## Workbench Architecture

The canonical Web layout is a shared product shell with a nested route outlet.
The shell owns the following cross-route concerns:

- primary navigation
- device drawer
- runtime capability disclosure
- shared status footer

Route pages own their workspace-specific state, but preview and print actions
must still flow through the shared artifact seam.

The two formal workspaces are:

- `template workspace`
- `canvas workspace`

They are intentionally parallel surfaces with different editing affordances but
the same preview and print contracts.

The template workspace is now responsible for two adjacent catalog surfaces:

- system templates used as read-only structured print entry points
- browser-local user templates used for structured print entry and return
  editing

Selecting a template card should enter the structured print-entry flow
immediately. Template editing stays as a secondary explicit action so the main
list surface does not duplicate the primary entry action.

The canvas workspace is the only place that can author or revise templates. It
must expose explicit save, save as, and version-history actions without
changing the server-side read-only nature of system templates.

Version history belongs to a save-adjacent drawer, not to a permanently visible
inspector column. Replaceable field editing should stay minimal and desktop-fit:
one layer name field plus one field-name autocomplete input that can reuse or
create an existing field label.

## Web Modes

The Web surface supports two operational modes without cloning routes:

1. Runtime mode
2. Demo mode

Both modes share:

- route structure
- layout hierarchy
- form models
- preview panels
- capability disclosure patterns

The only variation points are the `surface` and capability contract.

## Pages Contract

GitHub Pages publishes the static Web runtime with Vite `base: "./"` so the
generated HTML, JS, CSS, and asset URLs remain relative.

Developer startup contract:

- normal Web development uses `bun run dev:preview`
- the active development surface is the Vite dev server, not the built Pages
  preview
- `preview:web:pages` is a post-build verification surface only
- `base: "./"` is a static bundle rule for Pages builds, not the dev-server
  rule

Pages must remain static:

- no server-side API dependency
- no authenticated production backend
- no release-side runtime coupling

`browser-static` runtime performs template loading, preview generation, artifact
storage, and packet encoding fully in the browser. The browser-direct print path
may remain live in supported browsers because it is a pure-browser capability.
Server-only capabilities stay on `server-http`. `demo mode` reuses the Mock API
layer and returns successful simulated preview / refresh / print actions with
explicit hardware gating.

`browser-static` keeps BrowserRouter semantics. It must not switch to hash
routing as a deployment workaround.

## Responsive Contract

The formal desktop support band is `1024-1920w × 720-1280h`.

Benchmark layouts:

- `1024×768`: `focus-paired dual-pane`
- `1280×800`: compact three-column workspace
- `1440×900`: standard three-column workspace
- `1600×1024`: relaxed three-column workspace

At `1024-1279px`, the template route uses a route-owned single-outlet flow with
an optional side preview rail, while the canvas route keeps the stage visible
and switches one contextual side rail. This is a route contract, not a user
preference setting.

At `>=1280px`, the template workspace must keep the left rail wide enough for a
readable two-column large-card grid even after introducing grouped system and
browser-local template sections.

## Runtime Readiness Contract

When `TUCKMARK_ENABLE_SERVER_SIDE_PRINT=1`, the service-api print path is part
of the runtime contract and the server must fail fast if detonger readiness is
incomplete.

When `TUCKMARK_ENABLE_BROWSER_DIRECT_PRINT=1`, the browser-direct print path is
part of the Web contract and must stay usable without `/api` packet helpers.

## Delivery Contract

This repository ships through split workflows:

- `label-gate`: validates release intent on PRs
- `ci-pr`: runs preemptible PR checks
- `ci-main`: runs post-merge verification and writes the durable release
  snapshot
- `pages`: deploys the static Web demo from `main`
- `release`: consumes the release snapshot and publishes GitHub Releases
- `notify-release-failure`: emits operator-facing failure context

This split keeps release state durable and prevents burst merges from losing
release intent.
