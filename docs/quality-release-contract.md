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

`ci-main` writes an immutable `release-intent.json` snapshot after merge. Its
release type and channel come only from the pull request's merge-time labels.
Manual `ci-main` dispatch is not a mechanism for recovering or recomputing
those labels.

A skipped `type:none` snapshot may be promoted only by the dedicated manual
post-merge promotion workflow. Promotion requires the exact merged PR, merge
SHA, source CI run, source artifact, legal non-`none` type/channel, an actor,
and a reason. It validates that the PR and source snapshot match, writes a new
immutable intent with a stable `intent_id`, and never edits the original
snapshot or its labels.

`release.yml` consumes that snapshot with release orchestration checked out
from the trusted workflow revision on `main`. It retains full history so a
historical snapshot `merge_sha` can be tagged, while host-tools builds, the
release plan, and the published tag remain bound to that snapshot target. It
publishes:

- `stable`: `vX.Y.Z`
- `preview`: `vX.Y.Z-preview.<n>`

Before creating a GitHub Release, publication creates an annotated tag at the
exact snapshot `merge_sha`. The tag carries the release intent marker and is a
recoverable reservation: a failed publish retry must rediscover the same marker,
target SHA, and version rather than advancing the release train. A pre-existing
tag that is not reserved for the exact intent and SHA is rejected. Release
creation verifies that this remote tag already exists and never asks GitHub to
create a tag from an arbitrary default-branch or historical target.

The workflow creates a draft bound to that tag and the release intent marker,
uploads or re-uploads its assets, and publishes it only after the uploads
succeed. A retry may resume only that exact draft at the snapshot merge SHA; it
may contain only a subset of the five expected asset names before upload and
must contain exactly that complete set before publication. A published,
mismatched, or extra-asset release is rejected.

Published GitHub Releases must include human-readable release notes generated
from the verified release snapshot and its merged pull request context. A
single-line placeholder body is not a valid release.

Manual release and backfill require the exact source workflow run, artifact,
and `intent_id`; they never select the newest pending artifact by scanning
history. Before building or publishing, the workflow rejects an intent that is
already recorded in an existing GitHub Release, so replay cannot create a
second version for the same intent.

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
host tools again. It also verifies the embedded `server-http` PWA control resources by MIME and
content, uses a real browser to register the worker at root scope, confirms the
complete-cache marker, and proves that DEVD API and printing operations remain
online. The same isolated smoke directly runs the documented
`npx --yes skills add` command against the downloaded archive with a temporary
home directory and verifies that only the two released Skills are installed.

Released host tools never ship an installer script. Installation is a manual,
documented copy into stable unversioned paths; the release workflow does not
change user PATH settings.

`workflow_dispatch` can backfill an explicitly identified pending host-tools
intent without recomputing release intent from a PR head. Snapshots created for
the retired workspace-bundle release contract are intentionally not eligible
for this binary release path.

## Drift Policy

Repository files define the contract. GitHub settings must match them.

If GitHub required checks, Pages settings, homepage, labels, or branch
protection drift away from the repository declaration, the repository is not in
an aligned state.
