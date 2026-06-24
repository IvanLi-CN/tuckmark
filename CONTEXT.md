# Tuckmark Context

## Glossary

- `Tuckmark`: the product and repository-owned contract
- `detonger`: the lower transport and printer control layer
- `artifact`: a rendered preview or printable output tracked by Tuckmark
- `browser-direct print path`: the Web product path where the browser itself renders, encodes, and sends print data to hardware over Web Bluetooth
- `service-api print path`: the Web product path where the Web app asks the service runtime API to control hardware on its behalf
- `runtime bundle`: the release artifact for the HTTP runtime surface
- `CLI bundle`: the release artifact for the CLI surface
- `Web app static runtime`: the owner-facing static deployment that runs fully in
  the browser
- `demo mode`: the formal Web route tree backed by the Mock API layer with
  explicit hardware simulation
- `server runtime`: the `/api`-backed Web deployment surface
- `browser runtime`: the pure browser-local Web runtime surface
- `template workspace`: the route-owned template workbench with template list,
  batch data table, preview rail, and print rail
- `canvas workspace`: the route-owned freeform canvas workbench with Konva
  stage, tools, layers, property rail, preview rail, and print rail
- `device drawer`: the shared right-side drawer for device selection, print-path
  status, and device actions
- `recent activity registry`: the browser-local metadata registry that records
  recent templates and recent prints
- `focus-paired dual-pane`: the narrow desktop responsive contract that keeps
  the center workspace visible and swaps the active side pair based on user
  focus

## Current Product Truth

Tuckmark is not a printer driver project and not a Bluetooth utility. It is a
workspace for turning structured content into printable labels through shared
artifacts and multiple automation surfaces.

The Web product has two formal print paths with two separate switches. The
`browser-direct print path` is a pure-browser path. The `service-api print path`
is a separate runtime path with stronger dependency requirements.

`detonger` remains an implementation dependency. It should appear as a powered
by / lower-layer attribution, not as the user-facing brand.

## Delivery Truth

- default branch: `main`
- merge model: PR-only
- commit model on protected branch: signed commits required
- release model: label-driven single-product GitHub Release
- static Web hosting model: GitHub Pages on `main`, independent from release

## UI Truth

The canonical user interface lives in `apps/web`.

The canonical Web product is a four-page desktop workbench:

- `home`
- `templates`
- `canvas`
- `system`

The canonical shell is top-middle-bottom with one shared route tree, one shared
device drawer, and one shared artifact seam across `server-http`,
`browser-static`, and `demo`.

Storybook and Playwright are QA surfaces. They support component-state review,
browser validation, and visual evidence. They do not replace the static runtime
and they do not define an alternate product UI.
