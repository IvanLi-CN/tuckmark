# Tuckmark Agent-Assisted Inventory Intake

## Background

External agents can interpret private order exports and product pages, while Tuckmark must remain a deterministic inventory, label, and confirmation system. The product must never ingest an original order file, invoke an LLM, or automate a browser as part of this capability.

## Scope

- Define the `tuckmark.agent-import.v1` proposal contract for agent-produced new-material and restock entries.
- Let a DEVD `server-http` instance own the configured local data directory, short-lived import sessions, field-completion events, and confirmed inventory writes.
- Make CLI commands exchange proposal, catalog, inventory, and event data with DEVD.
- Provide a confirmation route with two editable tables: **new items** and **restock existing inventory**.
- Publish released and source-tree Agent Skills that describe order interpretation, identity decisions, datasheet links, and CLI interaction.

## Non-goals

- Tuckmark does not parse Taobao exports, host an LLM, crawl product pages, or store original order content.
- Datasheet PDFs are not uploaded or mirrored. A material stores a manufacturer or authorized-distributor URL, or a reason that no trustworthy URL was found.
- `browser-static` does not support managed agent import sessions.

## Contracts

### Proposal

`tuckmark.agent-import.v1` contains Agent-selected items. Each item is either:

- `new`: a proposed material, a positive inbound quantity, one selected label template, Agent-ranked alternatives, initial field values, optional datasheets, and an optional non-blocking `needsAttention` message.
- `restock`: an Agent-selected stable `targetMaterialId`, a positive inbound quantity, and an optional non-blocking `needsAttention` message. It retains its existing material and label binding rather than receiving a recommendation.

The Agent decides material identity. It may set `needsAttention` when it is uncertain; neither the CLI nor confirmation page forces a separate identity confirmation.

### Template Catalog

Catalog records expose `recommendedUses[]`, each with a human-readable scope and integer weight. New material recommendations are Agent-authored and ordered by the Agent. A template with an empty scope list remains usable but is not a default recommendation. DEVD catalog responses contain system templates and templates in the shared data directory only. Browser-local templates are selectable only manually in the confirmation page and create a field-completion event.

### Session Authorization and Lifetime

The CLI creates a high-entropy session identifier and secret. The confirmation URL includes only the secret in its fragment. Every session request presents both values, with the secret in an HTTP header. Sessions, including completed or cancelled sessions, expire and are removed after 30 minutes.

### Template Completion

When the user changes a new material template, DEVD creates a `template-input-requested` event containing the selected template field contract and the item revision. The page freezes only that template panel while it awaits the Agent. The Agent uses the CLI to fulfill the event. A response with an older revision is rejected and never overwrites user edits.

When the user manually selects a browser-local template, the page supplies its canvas snapshot only to the authenticated DEVD session. On successful confirmation, DEVD copies it into the shared directory under a new template ID in the same recoverable transaction; later CLI and server-side printing therefore never depend on browser-local storage.

### Confirmed Writes

Confirmation writes are server-owned and recoverable. Selected new items create one material, one label binding, and one inbound adjustment. Selected restocks create only an inbound adjustment for an active existing material. The service serializes commits, accumulates repeated restocks against the latest in-transaction quantity, retains the global matrix-code uniqueness invariant, and refreshes the shared directory manifest. Missing targets, archived targets, conflicts, or concurrent changes abort the transaction without partial visible writes.

## Acceptance Criteria

- CLI catalog and inventory commands read DEVD data; `--devd-url` wins over `TUCKMARK_DEVD_URL` and either omission fails.
- The create command opens an authorized confirmation URL unless `--no-open` is supplied.
- The page presents separate editable tables for new-material and restock records. It supports full editing for new-material records, non-blocking attention/datasheet warnings, and selection. Restock controls edit only the persisted intake values (selection, quantity, and source note); target material details stay visible and read-only because confirmation writes only its inbound adjustment.
- Template switches produce an Agent event, wait state, and fresh field preview after fulfillment.
- Tests use mocked order-derived proposals only. No real order file, session secret, product body, or screenshot is committed.

## Visual Evidence

Mock-only desktop confirmation route, covering both **new items** and **restock existing inventory**, editable datasheet and template fields, a non-blocking identity reminder, and a missing-datasheet warning:

![Agent-assisted inventory intake confirmation page](assets/agent-import-ui-demo.png)
