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

Pages is independent from GitHub Release publication. Mainline pushes produce
the default owner-facing Pages deployment, while release publication dispatches
the Pages workflow from `main` with a `release_tag` input so protected Pages
environments never receive a tag deployment ref.
Owner-facing footer metadata follows one contract:

- tagged deploys show the published release version and keep the build ref in
  tooltip metadata
- tagged deploys link that release version to the repository's OctoRill public
  releases list with `highlight=tag:<release-version>` and
  `highlight_active=tag:<release-version>`
- untagged mainline deploys show `build <shortsha>` only

## Release Contract

`ci-main` writes a durable `release-intent.json` snapshot after merge.

`release.yml` consumes that snapshot, checks out the snapshot `merge_sha`, and
publishes:

- `stable`: `vX.Y.Z`
- `preview`: `vX.Y.Z-preview.<n>`

Published GitHub Releases must include human-readable release notes generated
from the verified release snapshot and its merged pull request context. A
single-line placeholder body is not a valid release.

The generated release notes follow one contract:

- an opening summary line states the release class, release type, version, and
  merged PR title
- `Included Change` lists the merged PR link and title
- `Release Metadata` lists the release version, `channel:*`, `type:*`,
  `merge_sha`, and PR link
- `Bundles` lists the published host-tools artifacts

Before publication, the release workflow must also emit a durable
`release-context-<merge_sha>` artifact containing:

- `release-context.json`
- `release-notes.md`

If a releasable snapshot is missing PR context, the PR metadata cannot be
loaded, or any required release-notes section is absent, the release workflow
must fail before `gh release create`.

Preview releases are GitHub prereleases and must not override the owner-facing
Pages deployment accidentally through an arbitrary non-contract workflow path.

The release train is monotonic across preview and stable publication:
once `main` has moved to a higher preview train, later preview/stable releases
must continue or finalize that train instead of falling back to a lower patch
line.

The release workflow uploads:

- `tuckmark-host-tools-darwin-arm64.tar.gz`
- `tuckmark-host-tools-darwin-x64.tar.gz`
- `tuckmark-host-tools-linux-x64.tar.gz`
- `tuckmark-host-tools-windows-x64.zip`
- `SHA256SUMS`
- `release-context-<merge_sha>` artifact with release notes and release context

Each platform archive contains standalone `tuckmark` and `tuckmark-devd`
executables, private detonger helpers, and only the two released Skills. The
build matrix creates every archive on its native platform and verifies it in an
isolated directory before publication. A post-publication Linux smoke test
downloads the release assets, validates `SHA256SUMS`, and runs the extracted
host tools again. That same isolated smoke directly runs the documented
`npx --yes skills add` command against the downloaded archive with a temporary
home directory and verifies that only the two released Skills are installed.

Released host tools never ship an installer script. Installation is a manual,
documented copy into stable unversioned paths; the release workflow does not
change user PATH settings.

`workflow_dispatch` can backfill pending host-tools snapshots without
recomputing release intent from a PR head. Snapshots created for the retired
workspace-bundle release contract are intentionally not eligible for this
binary release path.

## Drift Policy

Repository files define the contract. GitHub settings must match them.

If GitHub required checks, Pages settings, homepage, labels, or branch
protection drift away from the repository declaration, the repository is not in
an aligned state.
