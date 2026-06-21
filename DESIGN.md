# Tuckmark Design Notes

## Architecture Boundaries

Tuckmark is a Bun-first TypeScript workspace with one product-facing Web app and
multiple integration surfaces.

The Web app uses an explicit `ApiClient` boundary:

- `HttpApiClient` talks to the runtime `/api`
- `MockApiClient` serves GitHub Pages and local mock shells

The UI must not encode transport-specific behavior directly into React
components. Runtime capabilities are resolved outside the presentational tree
and exposed as stable feature flags.

The owner-facing capability contract is expressed as two print paths:

- `browser-direct print path`
- `service-api print path`

The UI must not expose packet-helper details such as HTTP packet sources as
product capabilities.

## Web Modes

The Web surface supports three operational modes without cloning routes:

1. Real runtime mode
2. Seeded demo mode
3. Mock shell mode

All three modes share:

- route structure
- layout hierarchy
- form models
- preview panels
- capability disclosure patterns

The only variation point is the API and capability contract.

## Pages Contract

GitHub Pages publishes `apps/web` under the repository base path `/tuckmark/`.

Pages must remain static:

- no server-side API dependency
- no authenticated production backend
- no release-side runtime coupling

The browser-direct print path may remain live in supported browsers because it
is a pure-browser capability. The service-api print path is represented through
mock responses or explicit capability gates outside runtime mode.

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
