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
