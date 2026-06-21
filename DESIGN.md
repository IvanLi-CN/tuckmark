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
