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

Installed-PWA startup was later refined again after cold launches were observed
to expose a blank body until the routed workbench bundle mounted. The
browser-static entry HTML now ships a branded launch shell so startup latency is
communicated without changing the later non-blocking update lifecycle.

That launch shell was later refined again with coordinated light and dark
variants so installed PWAs no longer jump from a themed browser shell into an
unstyled or mismatched cold-start surface before the React runtime takes over.

The startup path was later tightened again around perceived performance and
offline correctness. Browser-static now boots through a thin async runtime
bootstrap, reports task-phase startup progress instead of fake 25/50/75/100
download placeholders, precaches only shell-plus-route assets during service
worker install, and silently warms the remaining feature assets after the
current route shell is already usable.

That startup contract was later corrected again after verification showed the
runtime workbench could still peek through underneath the owner-facing launch
surface during the `current route data ready` phase. The routed shell now stays
hidden until `shellReady` is true, so installed-PWA startup no longer feels
like it has already entered the app before the startup shell exits.

The owner-facing launch copy was then tightened again after runtime traces
showed deferred hydration and offline warmup often overlap rather than execute
as a neat sequential checklist. The public splash now keeps branded generic
copy with an indeterminate rail, while the internal startup milestones remain
available only to the control flow and verification surfaces.

That launch shell was simplified once more after review showed the secondary
bottom-right note card still read like explanatory chrome instead of a normal
loading affordance. The installed-PWA splash now keeps only the primary
brand/title/detail/progress composition and removes the extra note entirely.

Route-loading behavior was then tightened again after runtime verification
showed the first in-app page switch could still expose a large lazy-route
fallback that felt like the app was cold-starting twice. Deferred route chunks
now warm immediately after `shellReady`, nav intent preloads the likely target
route, and any remaining route race falls back to a small local skeleton
instead of a startup-like loading screen.
