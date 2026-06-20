# Tuckmark Bun Pages Release Contract Initialization

- Spec ID: `m2ksq`
- Status: `active`
- Owner: `Codex`

## Summary

Tuckmark must converge on a Bun-first product repository contract with a formal
Web surface, a Pages-backed owner demo, a durable PR-label release pipeline,
and a reproducible worktree bootstrap path.

## Requirements

### Product and naming

- Tuckmark is the product contract.
- `detonger` is the lower transport and control layer.
- The formal Web app and the Pages demo reuse the same route tree and component
  tree.

### Tooling and bootstrap

- Bun is the primary workspace toolchain.
- Local setup installs hooks, initializes `detonger`, and syncs missing local
  resources.
- Worktree bootstrap must be safe and idempotent.

### Web behavior

- The Web app resolves its mode through an explicit API abstraction.
- Static Pages uses a mock API layer.
- Runtime deployments use HTTP `/api`.
- `demo=true` and `demo=false` change contract behavior, not page structure.

### Delivery

- PR labels are the release-intent source of truth.
- Mainline release uses a durable snapshot and supports backfill.
- Pages deployment is separate from GitHub Release publication.
- Repository settings must align with repo-local declarations.

## Acceptance

- `bun run setup` succeeds from a fresh linked worktree.
- required checks match `.github/quality-gates.json`
- Pages serves the formal app under `/tuckmark/`
- Release can publish stable and preview bundles from durable snapshots
- GitHub labels, protection, and Pages settings align with repository truth

## Visual Evidence

This spec requires:

- Pages demo screenshots
- mock shell screenshots for `demo=false`
- Storybook and Playwright verification evidence bound to the latest merge-ready
  SHA

Current local evidence:

- `work/visual/pages-demo.png`: Pages-style seeded demo on the formal app surface
- `work/visual/mock-shell.png`: `demo=false` mock shell on the same route tree with capability gating
