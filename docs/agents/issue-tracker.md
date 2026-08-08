# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues. Use the `gh` CLI for
all reads and writes, inferring `IvanLi-CN/tuckmark` from the configured remote.

## Conventions

- Create issues with `gh issue create`; apply `ready-for-agent` when a ticket is
  ready for an implementation task.
- Read complete issue state with `gh issue view <number> --comments`.
- Record blocking edges with GitHub issue dependencies when available and keep
  a human-readable `Blocked by` entry in every ticket body.
- Comment, label, and close issues with the corresponding `gh issue` commands.
- GitHub Issues and pull requests share a number space; resolve ambiguous
  references before changing them.

## Pull Requests As A Request Surface

PRs as a request surface: no.

## Initiative Tickets

- Initiative tickets use the immutable envelope required by `$initiative-flow`.
- Child pull requests target the declared `prd/<topic>` integration branch.
- An Issue closes only after its child merge and matching integration CI pass.
- The aggregate pull request targets `main` and requires explicit owner approval.
