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
- Static Pages ships a browser-static PWA manifest, maskable icons, and a root
  service worker.
- After the first successful online load, the browser-static runtime must open
  from cached app-shell resources while offline.
- Browser-static updates are non-blocking: a newly detected version caches
  silently in the background, then prompts the user to update only when the
  waiting worker is ready.
- Runtime deployments use either `server-http` or `browser-static` surface.
- `demo=true` enters demo mode, `demo=false` and no param stay on runtime mode.

### Delivery

- PR labels are the release-intent source of truth.
- Mainline release uses a durable snapshot and supports backfill.
- Pages deployment is separate from GitHub Release publication.
- Published GitHub Releases trigger a fresh Pages deployment from the release
  tag so the browser-static footer version matches the published release tag.
- Repository settings must align with repo-local declarations.

## Acceptance

- `bun run setup` succeeds from a fresh linked worktree.
- required checks match `.github/quality-gates.json`
- Pages serves the formal app from the root path with relative assets
- Browser-static PWA install metadata is complete enough for browser-native
  installation.
- Offline refresh works for `/`, `/templates`, `/canvas`, and `/system` after a
  first successful online load.
- New-version caching is silent; the update prompt appears only after the
  waiting worker is ready.
- Release can publish stable and preview bundles from durable snapshots
- Pages release redeploys display the published release tag in footer metadata
- GitHub labels, protection, and Pages settings align with repository truth

## Visual Evidence

This spec requires deterministic evidence from repo-owned surfaces:

- static build inspection proving root-path relative asset URLs
- static build inspection proving PWA manifest, icons, service worker, and
  offline precache entries
- Playwright coverage for service worker registration and offline deep-link
  refresh after first load
- Storybook coverage for PWA update prompt component states

Non-deterministic screenshots from a live browser window do not count as proof for
this spec.

The prompt state gallery is captured from Storybook canvas using mock state only.
It covers all owner-facing prompt states: ready to update and activation in
progress. Background caching remains intentionally silent and has no visible
prompt state.

PR: include
![PWA update prompt state gallery](./assets/pwa-update-toast-state-gallery.png)

The ready-to-update action opens a project-owned confirmation dialog before
refreshing the page. The dialog replaces browser-native `confirm` behavior while
preserving the user-confirmed refresh contract.

![PWA update confirmation dialog](./assets/dialogs/pwa-update-confirm-dialog.png)

The owner-facing visual evidence is produced from the production browser-static
Pages build with the service worker lifecycle mocked to the ready-to-activate
state. It verifies the prompt location against the complete routed workbench
shell.

PR: include
![PWA update prompt in workbench viewport](./assets/pwa-workbench-update-toast-viewport.png)
