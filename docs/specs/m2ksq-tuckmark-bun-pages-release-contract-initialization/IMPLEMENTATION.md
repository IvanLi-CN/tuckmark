# Implementation Notes

## Planned Surfaces

- docs and product context files
- Bun-first workspace tooling
- Web API abstraction and explicit `surface + mode` resolver
- browser-static PWA manifest, icons, app-shell service worker, and update
  prompt lifecycle
- Storybook and Playwright QA surfaces
- split GitHub workflows for label gate, CI, Pages, release, and notifications
- GitHub repository settings alignment

## PWA Coverage

- `apps/web/vite.config.ts` emits `manifest.webmanifest` and `sw.js` only for
  `browser-static` production builds.
- `apps/web/vite.config.ts` and `apps/web/build-metadata.ts` now split
  owner-facing footer metadata into `TUCKMARK_APP_VERSION` and
  `TUCKMARK_BUILD_REF`.
  - tagged builds render a clickable `v<release-version>`, parse the configured
    GitHub repository URL into an OctoRill highlight deep link, and keep
    `build <shortsha>` in tooltip metadata
  - untagged owner-facing builds render `build <shortsha>` only
  - local no-build-ref fallback can still use the root package version so local
    previews do not go blank
- `apps/web/vite.config.ts` also emits a same-origin `version.json` payload
  from the same runtime build metadata truth source. The browser-static service
  worker explicitly bypasses cache handling for this file so the probe never
  enters app-shell precache.
- `apps/web/public/pwa/` stores generated Tuckmark maskable PNG icons.
- `apps/web/src/pwa-lifecycle.ts` owns service worker registration, update
  detection, low-frequency background rechecks, stale-tab catch-up triggers,
  `SKIP_WAITING`, reload-on-controller-change behavior, and a same-origin
  `version.json` fallback for stranded clients that do not currently surface a
  waiting worker.
- `apps/web/src/pwa-lifecycle.ts` exposes the update-detection source in its
  runtime snapshot so owner-facing UI can stay generic while tests and stories
  still distinguish waiting-worker versus version-probe prompts.
- `apps/web/src/pwa-update-toast.tsx` owns the non-blocking update prompt shown
  from the shared workbench shell. Its update action uses a project-owned
  confirmation dialog instead of browser-native `confirm`.
- `apps/web/index.html` now ships a static launch shell so installed-PWA cold
  starts show branded startup feedback before the routed workbench JavaScript
  mounts. The static entry follows `prefers-color-scheme` so cold starts match
  the active light or dark system theme before React boots.
- `apps/web/src/main.tsx` is now a thin bootstrap: it restores SPA fallback
  location, preloads the current route chunk, and asynchronously imports
  `apps/web/src/app-runtime.tsx` instead of mounting the whole workbench bundle
  directly from the HTML entry.
- `apps/web/src/app-launch-splash.tsx` mirrors that shell for runtime review
  and now exposes an explicit `theme` prop so Storybook can lock light or dark
  states without relying on ambient browser settings.
- `apps/web/src/startup-contract.ts` formalizes startup task phases for the
  launch shell control flow and runtime pending UI:
  - `bootstrap-loaded`
  - `current-route-chunk-ready`
  - `current-route-data-ready`
  - `offline-warmup`
- The owner-facing launch shell no longer renders those internal phases as a
  visible checklist. `apps/web/index.html`, `apps/web/src/app-launch-splash.tsx`,
  and `apps/web/src/workbench-app.tsx` now keep the public copy generic, avoid
  secondary explanatory cards, and keep the progress rail indeterminate because
  route readiness, deferred hydration, and offline warmup may overlap in real
  startup traces.
- `apps/web/src/workbench-app.tsx` keeps the routed runtime shell mounted for
  code-loading continuity, but hides it with the platform `hidden` contract
  until `shellReady` flips true so the startup overlay never reveals the
  workbench underneath before the current route is actually ready.
- `apps/web/vite.config.ts` now classifies browser-static assets into
  `shell`, `route`, and `feature` tiers. The emitted service worker precaches
  only `shell + route` during `install`, bypasses `version.json`, and accepts
  `WARM_ASSETS` messages for silent background feature caching.
- `apps/web/src/pwa-asset-warmup.ts` triggers runtime warmup of `feature`
  assets only after the current-route shell is mounted, keeping offline
  coverage automatic without blocking startup navigation.
- `apps/web/src/workbench-route-registry.tsx` now exposes route preloading
  helpers for `/templates`, `/canvas`, and `/system`, and
  `apps/web/src/workbench-app.tsx` uses them in two places:
  - after `shellReady`, it silently warms the deferred route chunks in the
    background
  - on primary-nav pointer/focus intent, it opportunistically preloads the
    target route before click
- `apps/web/src/workbench-navigation.ts` now centralizes in-app route changes:
  it preloads the destination workbench route before calling the router
  navigation API, so owner-triggered page switches keep the current page in
  place until the destination module is ready.
- `apps/web/src/workbench-app.tsx` keeps `React.Suspense` fallback for route
  chunk races, but the fallback is now a small route-local skeleton instead of
  a card that reads like a second startup panel.
- `apps/web/tests/pwa.spec.ts` covers service worker registration, offline
  route refresh, launch-shell-first startup, warmup-complete offline behavior,
  deferred-route warmup preventing startup-like page-switch loading, and PWA
  asset inspection including `version.json` consistency, asset-tier
  separation, and non-precache behavior.
- `apps/web/src/pwa-lifecycle.test.ts` covers the guarded update-check cadence:
  immediate startup checks, 30-minute periodic polling, 10-minute stale-tab
  activation catch-up, offline skips, online retries, in-flight dedupe, and
  stranded-client version-probe mismatch recovery.
- `.github/workflows/pages.yml` runs on `main` pushes, manual dispatch, and
  published GitHub Releases. Release-triggered runs check out the published tag.
  Manual dispatch can also receive a `release_tag` input.
- `.github/scripts/release-notes.mjs` reads `work/release/release-plan.json`,
  loads the merged PR metadata, writes `work/release/release-context.json` and
  `work/release/release-notes.md`, and rejects releasable snapshots that cannot
  produce the required `Included Change`, `Release Metadata`, and `Bundles`
  sections.
- `.github/workflows/release.yml` dispatches `pages.yml` with the newly published
  release tag after `gh release create` succeeds. The workflow also uploads a
  `release-context-<merge_sha>` artifact and publishes through
  `--notes-file work/release/release-notes.md` instead of an inline placeholder
  body. Pages always injects `TUCKMARK_BUILD_REF`, and tagged deploys also
  inject `TUCKMARK_APP_VERSION`, so the browser-static footer metadata and its
  OctoRill deep link match the release/build that triggered the redeploy.
- `.github/workflows/notify-release-failure.yml` attempts to download the
  release-context artifact from the failed release run and includes the release
  version, PR number, channel, type label, merge SHA, and run URL when that
  context is available. If the artifact is unavailable, the notifier still
  emits the workflow run id and URL instead of failing a second time.
