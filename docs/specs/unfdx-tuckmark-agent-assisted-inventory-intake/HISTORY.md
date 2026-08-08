# History

## External Agent Boundary

The capability is intentionally orchestrated by the user's Agent. This separates private order interpretation and optional browser research from Tuckmark's deterministic storage and confirmation surfaces.

Device-detail Markdown never loads remote images automatically. Image syntax degrades to its alternative text so externally supplied evidence cannot turn an inventory view into an implicit network request.

## Template Suggested Use

The template suggested-use string describes where a template is suitable; it does not encode a cross-template score. Agents choose and order up to three new-material candidates from material evidence, while restocks keep their existing binding.

The Canvas workspace keeps the selected template's one suggested-use string in its template settings so authors can edit the same Agent-facing catalog context without introducing a second scoring model or polluting batch-entry data.

Suggested-use persistence keeps field presence meaningful: omission means the author did not edit the metadata, while a present empty string means the author intentionally cleared it. This preserves recommendations when older drafts are opened and saved without adding the field.

## Unified DEVD Data Plane

The main Web runtime and Agent Import share one DEVD transaction and revision authority. This removes split ownership between browser RuntimeStore and server inventory files, while keeping the static browser-only product deliberately independent.

## Unified ZIP Archive

User-facing import and export use one ZIP envelope across browser-static and server-http. The canonical write format remains the established directory tree so deployed browser-static releases can read new exports. Its manifest makes settings, templates, versions, working copies, materials, and adjustments independently visible and count-verifiable; the single-snapshot envelope remains readable so already exported files are not stranded.

## DEVD Ownership Boundary

Directory ownership is established before the first revisioned write through a durable marker and exclusive PID-scoped live lock. A stale lock is reclaimed only after its owner is gone, while a live owner is rejected so independent mutation queues cannot overwrite one another. Direct CLI mutations reject both an active DEVD configuration and an existing ownership marker. Loopback transport is verified from the connected peer rather than request headers. Archive completeness includes referential integrity, preventing imported history from creating orphaned template, binding, working-copy, or inventory records.

## Recent Activity Boundary

Recent templates and prints are browser-local presentation metadata rather than DEVD-owned records. Retaining that registry in `server-http` restores its visible history without reintroducing legacy sync requests or a browser fallback for templates, drafts, inventory, settings, archives, or backups.

Restock targets remain immutable after proposal creation, so confirmation edits cannot redirect an inbound adjustment. Agent-import credentials retain the confirmation Web origin separately from the DEVD API origin, which keeps the Vite-backed local confirmation route reachable during normal development.

Web resource commands run through one client mutation chain, so rapid settings and inventory changes use the revision returned by the preceding completed command. Import-session polling rejects responses that would regress an item revision or a terminal session state, and proposal validation rejects duplicate item IDs before a session is created.

Concurrent Web consumers share an in-flight runtime snapshot because template lists, archived templates, settings, and canvas startup all read the same authoritative state. An SSE revision event detaches the request for new consumers. A response at or above the notified revision remains authoritative despite transport reordering; an older response transparently joins the replacement request so higher-level query caches do not retain a stale result or invalidation error. The result is not cached after completion, and mutations still require the latest completed revision, so startup avoids duplicate stale read failures without weakening conflict detection.

- DEVD now owns the native CLI boundary through named Unix socket / Named Pipe
  IPC. CLI template, inventory, Agent Import, and inventory-print workflows no
  longer read business data directories or use an HTTP URL fallback. Remote MCP
  template management receives an injected authoritative data service instead
  of deciding a DEVD address.
- Formal DEVD startup resolves and saves its own platform data-directory
  configuration. Development Agent Import uses an explicit per-worktree test
  copy instead of requiring direct operation on the formal directory.

Agent Import compatibility is frozen outside the implementation language. The
Rust DEVD authority retains the HTTP, SSE, IPC, revision, session, recovery, and
archive contracts without changing proposal, inventory, or transaction data
shapes.
