---
name: tuckmark-agent-import-developer
description: Exercise private order-derived Tuckmark agent imports from the current source tree without accidentally invoking a globally installed release CLI. Use while developing or validating a cloned Tuckmark checkout.
---

# Tuckmark Agent Import Developer

Use this skill inside a Tuckmark source checkout. It deliberately invokes the
active Rust worktree CLI, never a globally installed `tuckmark` binary.

## Source Guard

Resolve the checkout before every command:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
test -f "$REPO_ROOT/crates/tuckmark-cli/Cargo.toml"
test -f "$REPO_ROOT/crates/tuckmark-devd/Cargo.toml"
```

Use this command prefix:

```bash
cargo run --locked --package tuckmark-cli --
```

Do not substitute a released `tuckmark` while validating source changes. Run
`bun run dev:data:prepare` when representative local data is needed; an existing
valid worktree copy is reused. Otherwise use the empty isolated directory
created by `bun run dev:preview`. Never point development DEVD at the formal
user data directory.

## Workflow

1. Follow the privacy, identity, and browser boundaries in `tuckmark-agent-import-user`. Never add a real order export to a fixture, test, screenshot, or commit.
2. Start the worktree's named Rust DEVD instance through `bun run dev:preview`,
   then query its catalog and inventory with the source CLI. The default instance is
   derived from the worktree path and printed at startup. Native commands use
   IPC; the CLI never reads the directory:

   ```bash
   cargo run --locked --package tuckmark-cli -- \
     agent-import catalog --instance "$DEVD_INSTANCE"
   ```

3. Use a mock `tuckmark.agent-import.v1` proposal for automated validation. Let the Agent decide `new` versus `restock`; use exact inventory IDs for restocks and set non-blocking `needsAttention` when evidence is incomplete. In each new-material payload, use `description` for the concise overview and one `deviceDetails` Markdown string for factual technical detail. Do not replace it with an Agent-invented structured object.
4. Create and drive a session with the same source command prefix:

   ```bash
   cargo run --locked --package tuckmark-cli -- \
     agent-import create --file /tmp/mock-proposal.json --instance "$DEVD_INSTANCE" --no-open
   cargo run --locked --package tuckmark-cli -- \
     agent-import wait --session <session-id> --instance "$DEVD_INSTANCE"
   ```

5. When the user changes a new-material template, read the event field contract, produce fresh values, and fulfill the event's exact revision. Do not overwrite a later user edit or select templates for an existing restock.
6. Keep confirmation user-owned. Do not call the confirm API from an Agent test workflow.

Template lifecycle validation uses the same instance boundary:

```bash
... template list --instance "$DEVD_INSTANCE"
... template update --id <template-id> --instance "$DEVD_INSTANCE" --recommended-use "<text>"
```

Complete package imports create saved versions. Metadata patches preserve the
saved-version count, and stale revisions must be re-read rather than replayed.

## Focused Validation

```bash
bun run test:native:cli
bun run --filter @tuckmark/inventory test
bun run --filter @tuckmark/web test
```
