# History

This spec was created to formalize the first repository-wide contract for:

- Bun-first workspace tooling
- browser-static Web runtime
- label-driven release orchestration
- GitHub repository quality settings

The browser-static runtime later became a full PWA contract: it keeps the same
route tree and relative Pages asset rules, but now adds app-shell precaching,
offline refresh after first load, native install metadata, and non-blocking
new-version activation.

Release follow-up Pages redeploys were added so the static Web footer no longer
falls back to the root package version after a release tag is published for the
same commit. Automated publication dispatches Pages explicitly with the new tag
because releases created with the repository token do not create a separate
Pages `release` event run.

The footer metadata contract was later tightened again: owner-facing release
version and build reference are now separate fields, so tagged deploys show
`v<release-version>` while keeping `build <shortsha>` in tooltip metadata, and
untagged mainline deploys show `build <shortsha>` only instead of masquerading
as a published version.

The PWA update contract was tightened again after stranded installed clients
were observed to miss prompts unless a waiting worker was already visible.
Browser-static Pages builds now publish same-origin runtime metadata through
`version.json`, and the lifecycle controller treats either waiting-worker ready
or version-probe mismatch as a valid non-blocking update prompt source.
