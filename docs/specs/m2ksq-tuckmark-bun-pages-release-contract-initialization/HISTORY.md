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

Release follow-up Pages redeploys were later removed again after they proved to
be the wrong owner-facing contract: preview publication could override the
browser-static Pages site with a lower release line, even while `main` had
already moved to a higher preview train.

The corrected contract keeps Pages on `main` and treats GitHub Releases as a
separate bundle channel. Preview publication is now a prerelease-only surface,
while the Pages footer reports the effective mainline build version
(`main+<shortsha>`) instead of mirroring release tags.
