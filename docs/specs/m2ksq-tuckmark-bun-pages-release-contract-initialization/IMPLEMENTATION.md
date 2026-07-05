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
  package version. GitHub tag values are normalized without a leading `v`
  because the UI owns the visible `v` prefix.
- `apps/web/public/pwa/` stores generated Tuckmark maskable PNG icons.
- `apps/web/src/pwa-lifecycle.ts` owns service worker registration, update
  detection, `SKIP_WAITING`, and reload-on-controller-change behavior.
- `apps/web/src/pwa-update-toast.tsx` owns the non-blocking update prompt shown
  from the shared workbench shell. Its update action uses a project-owned
  confirmation dialog instead of browser-native `confirm`.
- `apps/web/tests/pwa.spec.ts` covers service worker registration, offline
  route refresh, and PWA asset inspection.
- `.github/workflows/pages.yml` runs on `main` pushes, manual dispatch, and
  published GitHub Releases. Release-triggered runs check out the published tag.
  Manual dispatch can also receive a `release_tag` input.
- `.github/workflows/release.yml` dispatches `pages.yml` with the newly published
  release tag after `gh release create` succeeds. The Pages build injects that
  tag through `TUCKMARK_APP_VERSION` so the browser-static footer metadata
  matches the release that triggered the redeploy.
