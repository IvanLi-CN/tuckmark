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
- `apps/web/public/pwa/` stores generated Tuckmark maskable PNG icons.
- `apps/web/src/pwa-lifecycle.ts` owns service worker registration, update
  detection, `SKIP_WAITING`, and reload-on-controller-change behavior.
- `apps/web/src/pwa-update-toast.tsx` owns the non-blocking update prompt shown
  from the shared workbench shell.
- `apps/web/tests/pwa.spec.ts` covers service worker registration, offline
  route refresh, and PWA asset inspection.
