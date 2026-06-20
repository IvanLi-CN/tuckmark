# Tuckmark Context

## Glossary

- `Tuckmark`: the product and repository-owned contract
- `detonger`: the lower transport and printer control layer
- `artifact`: a rendered preview or printable output tracked by Tuckmark
- `runtime bundle`: the release artifact for the HTTP runtime surface
- `CLI bundle`: the release artifact for the CLI surface
- `Web app static runtime`: the owner-facing static deployment that runs fully in
  the browser
- `demo mode`: the formal Web route tree backed by the Mock API layer with
  explicit hardware simulation
- `server runtime`: the `/api`-backed Web deployment surface
- `browser runtime`: the pure browser-local Web runtime surface

## Current Product Truth

Tuckmark is not a printer driver project and not a Bluetooth utility. It is a
workspace for turning structured content into printable labels through shared
artifacts and multiple automation surfaces.

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

Storybook and Playwright are QA surfaces. They support component-state review,
browser validation, and visual evidence. They do not replace the static runtime
and they do not define an alternate product UI.
