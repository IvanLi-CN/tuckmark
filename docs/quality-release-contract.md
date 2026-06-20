# Tuckmark Quality And Release Contract

## Purpose

This document explains the human-readable merge, Pages, and release rules that
are enforced by repository config and GitHub workflows.

## Pull Request Contract

Every pull request must satisfy:

- signed commits
- PR-only updates to `main`
- required checks declared in `.github/quality-gates.json`
- valid release labels according to `.github/pr-label-release.json`

The release label contract is:

- exactly one of `type:major`, `type:minor`, `type:patch`, or `type:none`
- if `type:none`, no `channel:*` label is allowed
- otherwise exactly one of `channel:stable` or `channel:preview` is required

Unknown release labels and duplicate group labels are rejected.

## Pages Contract

GitHub Pages deploys from `main` through GitHub Actions.

The published site:

- uses relative asset URLs for the static `browser-static` build
- reuses the formal Web app route tree
- defaults to `runtime` when no query parameter is present
- supports `?demo=true` and `?demo=false` on the same app surface

Pages is independent from GitHub Release publication.

## Release Contract

`ci-main` writes a durable `release-intent.json` snapshot after merge.

`release.yml` consumes that snapshot to publish:

- `stable`: `vX.Y.Z`
- `preview`: `vX.Y.Z-preview.<n>`

The release workflow uploads:

- `runtime bundle`
- `CLI bundle`

`workflow_dispatch` can backfill pending snapshots without recomputing release
intent from a PR head.

## Drift Policy

Repository files define the contract. GitHub settings must match them.

If GitHub required checks, Pages settings, homepage, labels, or branch
protection drift away from the repository declaration, the repository is not in
an aligned state.
