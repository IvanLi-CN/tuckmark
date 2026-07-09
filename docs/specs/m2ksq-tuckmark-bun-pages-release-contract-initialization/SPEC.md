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
  runtime has confirmed a newer build through either a ready waiting worker or
  a same-origin version probe mismatch.
- Browser-static update checks run immediately on runtime startup, then continue
  at a low-frequency cadence while the page remains open.
- If the current tab has gone stale since its last update check, returning the
  page to a visible, focused, or newly online state must trigger a guarded
  catch-up update check without surfacing any extra loading UI.
- Browser-static builds must publish a same-origin `version.json` metadata probe
  that reflects the current `appVersion` and `buildRef`, bypasses app-shell
  precache, and is fetched with cache-busting semantics so stranded clients can
  detect newer deployments.
- Runtime deployments use either `server-http` or `browser-static` surface.
- `demo=true` enters demo mode, `demo=false` and no param stay on runtime mode.

### Delivery

- PR labels are the release-intent source of truth.
- Mainline release uses a durable snapshot and supports backfill.
- Pages deployment is separate from GitHub Release publication.
- Published GitHub Releases and automated release publication trigger a fresh
  Pages deployment with release tag metadata so the browser-static footer shows
  the published release version while the build reference remains available in
  tooltip metadata.
- Untagged mainline Pages deploys must expose `build <shortsha>` only instead
  of reusing stale package or release version text.
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
  runtime confirms a newer build through a waiting worker or version-probe
  mismatch.
- Long-lived browser-static tabs continue to recheck for new versions at a low
  frequency, while stale or stranded tabs catch up when the page becomes
  active, focused, or returns online.
- `version.json` stays aligned with the active Pages build metadata and is not
  precached by the service worker.
- Release can publish stable and preview bundles from durable snapshots
- Pages redeploys after release publication display the published release tag
  in footer metadata and expose `build <shortsha>` via tooltip
- Untagged `main` Pages deploys display `build <shortsha>` only in footer
  metadata
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
It covers all owner-facing prompt states: waiting-worker ready, stranded-client
version-probe mismatch ready, and activation in progress. Background caching
remains intentionally silent and has no visible prompt state.

PR: include
![PWA update prompt state gallery](./assets/pwa-update-toast-state-gallery.png)

The ready-to-update action opens a project-owned confirmation dialog before
refreshing the page. The dialog replaces browser-native `confirm` behavior while
preserving the user-confirmed refresh contract.

![PWA update confirmation dialog](./assets/dialogs/pwa-update-confirm-dialog.png)

The owner-facing placement evidence is produced from a repo-owned Storybook
workbench-shell fallback with the update lifecycle mocked to the stranded-client
version-probe mismatch state. It verifies the prompt location against the
complete routed workbench shell without depending on a live deployment or an
already-installed browser shell.

PR: include
![PWA update prompt in workbench viewport](./assets/pwa-workbench-update-toast-viewport.png)

The footer build-metadata contract is captured from Storybook canvas so release
and untagged states can be reviewed without relying on a live deployment.
Tagged builds keep the published release version visible while exposing the
exact build reference in tooltip metadata for operator support.

PR: include
![Tagged footer build metadata](./assets/footer-build-meta-tagged.png)

Hovering the tagged footer metadata reveals the build reference without turning
it into always-visible footer text.

PR: include
![Tagged footer build metadata tooltip](./assets/footer-build-meta-tagged-tooltip.png)

Untagged mainline builds do not masquerade as a release. They expose only the
current `build <shortsha>` marker in the owner-facing footer.

PR: include
![Untagged footer build metadata](./assets/footer-build-meta-untagged.png)
