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
storage, and packet encoding fully in the browser. Server-only capabilities stay
on `server-http`. `demo mode` reuses the Mock API layer and returns successful
simulated preview / refresh / print actions with explicit hardware gating.

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
