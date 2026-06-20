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

Server-only capabilities are represented through mock responses or explicit
capability gates. Browser-native capabilities such as Web Bluetooth may remain
live when the browser supports them.

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
