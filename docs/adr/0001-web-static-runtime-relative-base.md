# ADR 0001: Web Static Runtime Uses Relative Base And Explicit Surface

## Status

Accepted

## Context

The owner-facing static deployment is published on GitHub Pages and served
through a custom root domain. The previous build emitted asset URLs under a
fixed `/tuckmark/` prefix and inferred demo behavior from `hostname`, `origin`,
and `BASE_URL`. That contract broke on the custom domain and produced a white
screen because the HTML requested `/tuckmark/assets/...` from the root host.

The Web app also mixed two unrelated decisions:

- how assets should be resolved at build time
- which runtime surface and mode should be active at request time

That made static hosting fragile and forced product behavior to depend on host
shape rather than explicit contract.

## Decision

The Web app now uses:

- Vite `base: "./"` for `browser-static` builds
- explicit `AppSurface = "server-http" | "browser-static"`
- explicit `AppMode = "runtime" | "demo"`
- query-param mode selection only: `?demo=true` enters demo mode; any other
  value remains runtime mode

`browser-static` runtime renders templates, persists artifacts, generates preview
PNG data, and encodes printer packets fully in the browser. `server-http`
continues to expose `/api` for local development and server-backed printing.

`demo mode` continues to use the Mock API layer, but real hardware capabilities
are disabled. Refresh, preview, and print return successful simulated actions
with fixed, human-plausible delay.

## Consequences

- GitHub Pages and custom-domain root deployments no longer depend on a repo
  path prefix.
- Runtime behavior no longer depends on `github.io`, `hostname`, `origin`, or
  `BASE_URL`.
- The UI reads artifact preview and packet data through a data seam instead of
  HTTP-only URL helpers, so HTTP, browser runtime, and demo clients share one
  route tree and one component tree.
- Server printer list and server-side print actions remain visible only on the
  `server-http` surface.
