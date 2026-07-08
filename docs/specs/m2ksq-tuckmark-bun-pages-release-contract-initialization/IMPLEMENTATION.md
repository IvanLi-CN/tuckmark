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
- `apps/web/vite.config.ts` resolves footer metadata from
  `TUCKMARK_APP_VERSION`, then from GitHub tag build context, then from the root
  package version. The browser-static shell now renders that effective version
  verbatim so mainline builds can show values like `main+<shortsha>` while tag
  builds keep the full release tag.
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
- `.github/workflows/pages.yml` runs on `main` pushes and manual dispatch, but
  the deploy job is guarded to `refs/heads/main`. It always checks out `main`,
  injects `TUCKMARK_APP_VERSION=main+<shortsha>`, and deploys that owner-facing
  browser-static runtime without consulting GitHub Releases.
- `.github/workflows/release.yml` serializes release publication, pins new tags
  to the snapshot `merge_sha`, checks out that exact merge commit before bundle
  build, and publishes `channel:preview` as GitHub prereleases with
  `--latest=false` so preview artifacts cannot silently become the owner-facing
  default surface.
