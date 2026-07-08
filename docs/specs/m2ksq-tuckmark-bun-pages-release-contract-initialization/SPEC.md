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
- Browser-static update checks run immediately on runtime startup, then continue
  at a low-frequency cadence while the page remains open.
- If the current tab has gone stale since its last update check, returning the
  page to a visible, focused, or newly online state must trigger a guarded
  catch-up update check without surfacing any extra loading UI.
- Runtime deployments use either `server-http` or `browser-static` surface.
- `demo=true` enters demo mode, `demo=false` and no param stay on runtime mode.

### Delivery

- PR labels are the release-intent source of truth.
- Mainline release uses a durable snapshot and supports backfill.
- Pages deployment is separate from GitHub Release publication.
- The owner-facing Pages deployment always rebuilds from `main` and displays a
  mainline effective version instead of a release tag.
- Manual Pages dispatches stay guarded to `main`; non-`main` refs must not
  become the owner-facing deployment surface.
- GitHub Releases keep independent channel semantics: `stable` is a normal
  release, `preview` is a GitHub prerelease, and preview publication must never
  override the owner-facing Pages deployment.
- Release train selection is monotonic across published tags: once `main` has
  moved to a higher preview train, later preview or stable publication must
  continue or finalize that train instead of falling back to a lower patch line.
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
- Long-lived browser-static tabs continue to recheck for new versions at a low
  frequency, while stale tabs catch up when the page becomes active or returns
  online.
- Release can publish stable and preview bundles from durable snapshots, with
  preview publication marked as GitHub prerelease
- Owner-facing Pages always reflects the latest deployed `main` commit and does
  not roll back to a published preview or stable release tag
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
