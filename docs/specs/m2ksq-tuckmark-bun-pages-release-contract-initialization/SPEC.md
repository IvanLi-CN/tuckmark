# Tuckmark Bun Pages Release Contract Initialization

- Spec ID: `m2ksq`
- Status: `active`
- Owner: `Codex`

## Summary

Tuckmark must converge on a Bun-first product repository contract with a formal
Web surface, a browser-static owner runtime, a durable PR-label release pipeline,
and a reproducible worktree bootstrap path.

## Requirements

### Product and naming

- Tuckmark is the product contract.
- `detonger` is the lower transport and control layer.
- The formal Web app and the static runtime reuse the same route tree and component
  tree.

### Tooling and bootstrap

- Bun is the primary workspace toolchain.
- Local setup installs hooks, initializes `detonger`, and syncs missing local
  resources.
- Worktree bootstrap must be safe and idempotent.

### Web behavior

- The Web app resolves its mode through an explicit API abstraction.
- Static Pages uses the browser-static runtime with relative asset URLs.
- Runtime deployments use either `server-http` or `browser-static` surface.
- `demo=true` enters demo mode, `demo=false` and no param stay on runtime mode.

### Delivery

- PR labels are the release-intent source of truth.
- Mainline release uses a durable snapshot and supports backfill.
- Pages deployment is separate from GitHub Release publication.
- Repository settings must align with repo-local declarations.

## Acceptance

- `bun run setup` succeeds from a fresh linked worktree.
- required checks match `.github/quality-gates.json`
- Pages serves the formal app from the root path with relative assets
- Release can publish stable and preview bundles from durable snapshots
- GitHub labels, protection, and Pages settings align with repository truth

## Visual Evidence

This spec requires deterministic evidence from repo-owned surfaces.

Accepted evidence for this contract is:

- static build inspection proving root-path relative asset URLs
- Playwright coverage for root-path runtime and explicit `?demo=true`
- Storybook coverage for stable `runtime` and `demo` states

Non-deterministic screenshots from a live browser window do not count as proof for
this spec and are not retained here.
