---
name: tuckmark-agent-import-user
description: Parse private order exports outside Tuckmark, identify materials and quantities, research product pages when permitted, then submit and complete a Tuckmark managed inventory import with the released CLI. Use outside a Tuckmark source checkout for Taobao or other order-derived intake.
---

# Tuckmark Agent Import

Use the released `tuckmark` CLI. Tuckmark itself does not parse order files, invoke an LLM, or automate a browser.

## Privacy Boundary

- Keep the original order export and product-page body local. Do not commit, upload, attach, log, or put either in a proposal.
- Use only a concise source note that the user approves. Never include account data, addresses, order numbers, or the session secret.
- Open a product page only in the user's already-authorized browser context. Stop for login, CAPTCHA, 2FA, payment, or any other identity challenge.
- Prefer manufacturer or authorized-distributor datasheet URLs. Do not download, mirror, or upload PDFs.

## Workflow

1. Resolve DEVD. Pass `--devd-url <url>` or set `TUCKMARK_DEVD_URL`; the command fails without one.
2. Read only the Agent recommendation catalog and current inventory:

   ```bash
   tuckmark agent-import catalog --devd-url "$DEVD_URL"
   tuckmark agent-import inventory --devd-url "$DEVD_URL" --query "<model or keyword>"
   ```

   Catalog results include only system and shared-directory templates. `recommendedUses` gives a scope and weight; rank the top three only for **new** materials. An empty list means the template remains usable but is not a default recommendation.

3. Interpret the order outside Tuckmark. Decide material identity yourself; do not run name matching that silently converts a new item into a restock. Use `kind: "restock"` only with the exact `targetMaterialId` returned by inventory. Include that material's `updatedAt` as `targetMaterialUpdatedAt`.
4. Add `needsAttention` when identity, quantity, suffix, or datasheet evidence is uncertain. It is non-blocking: do not force the user to certify the match.
5. Build a local, temporary `tuckmark.agent-import.v1` proposal. New items must have one default `template`, up to two ordered alternatives, positive inventory quantity, positive `labelPrintQuantity`, material fields, and optional datasheets. Derive label quantity from storage packages or independently labeled units; never copy the inventory quantity blindly. Restocks must keep `template` absent.

   ```json
   {
     "schema": "tuckmark.agent-import.v1",
     "sourceNote": "purchase receipt",
     "items": [{
       "id": "agent-local-item-1",
       "kind": "new",
       "selected": true,
       "quantity": 100,
       "labelPrintQuantity": 1,
       "material": {
         "fullName": "Example IC",
         "description": "",
         "packagingRemark": "reel",
         "datasheets": [{
           "title": "Manufacturer datasheet",
           "url": "https://manufacturer.example/datasheet.pdf",
           "source": "manufacturer"
         }]
       },
       "sourceNote": "purchase receipt",
       "template": { "source": "system", "id": "cable-tag", "name": "Cable Tag", "fields": [], "recommendedUses": [] },
       "templateAlternatives": [],
       "templateInput": {},
       "revision": 0,
       "pendingTemplateEventId": null
     }]
   }
   ```

6. Create the session. The CLI opens the confirmation page unless `--no-open` is supplied. It prints a session ID and permission-restricted credential-file path, never the secret.

   ```bash
   tuckmark agent-import create --file /tmp/proposal.json --devd-url "$DEVD_URL"
   ```

7. Wait for user changes. If the user switches a new-material template, DEVD creates a field-contract event and freezes only that label panel. Poll and fulfill the exact event revision:

   ```bash
   tuckmark agent-import wait --session <session-id> --devd-url "$DEVD_URL"
   tuckmark agent-import fulfill --session <session-id> --event <event-id> --revision <revision> \
     --input '{"field":"value"}' --devd-url "$DEVD_URL"
   ```

   Do not fulfill an event with guessed fields. A stale revision is rejected; refresh with `wait`, regenerate values for the new field contract, and continue waiting.

8. Do not confirm on the user's behalf. The user reviews, edits, selects items, and confirms in the Web App. Sessions expire after 30 minutes.
