---
name: tuckmark-agent-import-developer
description: Exercise private order-derived Tuckmark agent imports from the current source tree without accidentally invoking a globally installed release CLI. Use while developing or validating a cloned Tuckmark checkout.
---

# Tuckmark Agent Import Developer

Use this skill inside a Tuckmark source checkout. It deliberately invokes the active worktree source CLI, never a globally installed `tuckmark` binary.

## Source Guard

Resolve the checkout before every command:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
test -f "$REPO_ROOT/packages/cli/src/index.ts"
```

Use this command prefix:

```bash
bun tsx --tsconfig "$REPO_ROOT/packages/cli/tsconfig.typecheck.json" "$REPO_ROOT/packages/cli/src/index.ts"
```

Do not substitute `tuckmark` while validating source changes. Start DEVD from the same checkout with `TUCKMARK_DATA_DIR` pointing at a disposable mock directory.

## Workflow

1. Follow the privacy, identity, and browser boundaries in `tuckmark-agent-import-user`. Never add a real order export to a fixture, test, screenshot, or commit.
2. Query the DEVD-owned catalog and inventory with the source CLI:

   ```bash
   bun tsx --tsconfig "$REPO_ROOT/packages/cli/tsconfig.typecheck.json" "$REPO_ROOT/packages/cli/src/index.ts" \
     agent-import catalog --devd-url "$DEVD_URL"
   ```

3. Use a mock `tuckmark.agent-import.v1` proposal for automated validation. Let the Agent decide `new` versus `restock`; use exact inventory IDs for restocks and set non-blocking `needsAttention` when evidence is incomplete. In each new-material payload, use `description` for the concise overview and one `deviceDetails` Markdown string for factual technical detail. Do not replace it with an Agent-invented structured object.
4. Create and drive a session with the same source command prefix:

   ```bash
   bun tsx --tsconfig "$REPO_ROOT/packages/cli/tsconfig.typecheck.json" "$REPO_ROOT/packages/cli/src/index.ts" \
     agent-import create --file /tmp/mock-proposal.json --devd-url "$DEVD_URL" --no-open
   bun tsx --tsconfig "$REPO_ROOT/packages/cli/tsconfig.typecheck.json" "$REPO_ROOT/packages/cli/src/index.ts" \
     agent-import wait --session <session-id> --devd-url "$DEVD_URL"
   ```

5. When the user changes a new-material template, read the event field contract, produce fresh values, and fulfill the event's exact revision. Do not overwrite a later user edit or select templates for an existing restock.
6. Keep confirmation user-owned. Do not call the confirm API from an Agent test workflow.

## Focused Validation

```bash
bun run --filter @tuckmark/inventory test
bun run --filter @tuckmark/server test
bun run --filter @tuckmark/cli test
bun run --filter @tuckmark/web test
```
