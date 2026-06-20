# Tuckmark Context

## Glossary

- `Tuckmark`: the product and repository-owned contract
- `detonger`: the lower transport and printer control layer
- `artifact`: a rendered preview or printable output tracked by Tuckmark
- `runtime bundle`: the release artifact for the HTTP runtime surface
- `CLI bundle`: the release artifact for the CLI surface
- `Web demo`: the owner-facing Pages deployment that reuses the formal Web app
- `mock shell`: the formal Web route tree backed by mock APIs and capability
  gating

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
- demo hosting model: GitHub Pages on `main`, independent from release

## UI Truth

The canonical user interface lives in `apps/web`.

Storybook and Playwright are QA surfaces. They support component-state review,
browser validation, and visual evidence. They do not replace the Pages demo and
they do not define an alternate product UI.
