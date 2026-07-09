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
  - tagged builds render `v<release-version>` and keep `build <shortsha>` in
    tooltip metadata
  - untagged owner-facing builds render `build <shortsha>` only
  - local no-build-ref fallback can still use the root package version so local
    previews do not go blank
- `apps/web/public/pwa/` stores generated Tuckmark maskable PNG icons.
- `apps/web/src/pwa-lifecycle.ts` owns service worker registration, update
  detection, low-frequency background rechecks, stale-tab catch-up triggers,
  `SKIP_WAITING`, and reload-on-controller-change behavior.
- `apps/web/src/pwa-update-toast.tsx` owns the non-blocking update prompt shown
  from the shared workbench shell. Its update action uses a project-owned
  confirmation dialog instead of browser-native `confirm`.
- `apps/web/tests/pwa.spec.ts` covers service worker registration, offline
  route refresh, and PWA asset inspection.
- `apps/web/src/pwa-lifecycle.test.ts` covers the guarded update-check cadence:
  immediate startup checks, 30-minute periodic polling, 10-minute stale-tab
  activation catch-up, offline skips, online retries, and in-flight dedupe.
- `.github/workflows/pages.yml` runs on `main` pushes, manual dispatch, and
  published GitHub Releases. Release-triggered runs check out the published tag.
  Manual dispatch can also receive a `release_tag` input.
- `.github/workflows/release.yml` dispatches `pages.yml` with the newly published
  release tag after `gh release create` succeeds. Pages always injects
  `TUCKMARK_BUILD_REF`, and tagged deploys also inject `TUCKMARK_APP_VERSION`,
  so the browser-static footer metadata matches the release/build that
  triggered the redeploy.
