# Tuckmark Product Contract

## Product Definition

Tuckmark is an agent-native label printing product register.

It is the owner-facing and agent-facing product surface that sits above
`detonger`, the transport and device-control layer. Tuckmark owns:

- template-driven label authoring
- preview and artifact lifecycle
- structured input and batch flows
- HTTP, CLI, MCP, and Web surfaces
- release and demo contracts exposed from this repository

`detonger` remains a lower-level dependency. It is not the product brand and
not the product contract boundary.

## Product Surfaces

- `apps/web`: the canonical Web surface and the canonical owner-facing Web demo
- `packages/server`: the HTTP runtime surface that serves `/api`
- `packages/cli`: the CLI surface that ships in the release bundle
- `packages/mcp`: the MCP surface for agent integration
- `packages/core`: the shared domain and rendering layer

## Demo Contract

The Web demo must reuse the same routes, component tree, and state model as the
formal Web app.

The demo must never fork into a separate demo-only page tree.

Demo behavior is controlled by runtime capability and seed contracts:

- `?demo=true`: owner-facing seeded demo contract
- `?demo=false`: formal route shell backed by mock API and capability gating
- no query parameter on GitHub Pages: default to demo-safe behavior
- non-Pages runtime without a demo override: default to the real HTTP `/api`
  contract

GitHub Pages is an owner-facing demo surface. It is not a Storybook
replacement, not a docs site, and not a second product surface.

## Release Contract

This repository releases a single product line.

- canonical release target: GitHub Releases
- version model: one SemVer line for the whole product
- channels: `stable` and `preview`
- bundled artifacts: `runtime bundle` and `CLI bundle`

There is no `component:*` version line in this repository.

## Repository Truth

Repository-local declarations are the source of truth for:

- release intent and label policy
- required checks and branch protection expectations
- Pages behavior and base path assumptions
- bootstrap and worktree setup expectations

GitHub repository settings must be aligned to those checked-in declarations.
