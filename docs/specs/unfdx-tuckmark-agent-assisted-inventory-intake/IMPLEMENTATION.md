# Implementation

## Coverage

- Shared proposal and inventory datasheet schemas define `tuckmark.agent-import.v1`, template applicability metadata, non-blocking attention, and link-only datasheets.
- DEVD owns shared template and inventory data, 30-minute authenticated sessions, template-input events, stale-response rejection, expiry cleanup, serial inventory commits, and recoverable all-or-nothing writes. A manually selected browser-local template is copied to the shared directory only after confirmation succeeds.
- `tuckmark agent-import` provides catalog, inventory, create, open, wait, and fulfill commands with an explicit `--devd-url` / `TUCKMARK_DEVD_URL` boundary. Released and source-tree Skills guide Agents through the same contract.
- The `/agent-import/:sessionId` confirmation route presents two row-oriented editable tables: primary new-material intake fields are inline, while supplementary fields, the label preview, and template fields expand in a detail row; restock intake controls edit selection, quantity, and source note inline. The import-selection column uses a compact checkbox without redundant state text, and the compact action column keeps its controls within the desktop table width. It supports browser-local manual templates, template wait states, and a Storybook state gallery. Existing-material fields are displayed read-only because a restock persists only an inbound adjustment. The mock-only desktop result is recorded in `SPEC.md`.

## Operational Boundary

DEVD must be started in `server-http` mode with `TUCKMARK_DATA_DIR` pointing at the local shared directory. `browser-static` intentionally has no compatible API implementation.
