import { describe, expect, it } from "vitest"

import { createAgentImportDemoSession } from "./agent-import-demo-data.js"
import {
  isCurrentAgentImportSession,
  reconcileAgentImportDrafts,
} from "./agent-import-draft-reconciliation.js"

describe("reconcileAgentImportDrafts", () => {
  it("rejects a poll response that predates the active item or terminal state", () => {
    const current = createAgentImportDemoSession()
    const advanced = {
      ...current,
      proposal: {
        ...current.proposal,
        items: current.proposal.items.map((item) => ({ ...item, revision: item.revision + 1 })),
      },
      state: "completed" as const,
    }

    expect(isCurrentAgentImportSession(current, advanced)).toBe(false)
    expect(isCurrentAgentImportSession(advanced, current)).toBe(true)
  })

  it("keeps an unsaved ordinary edit when a pending template event is fulfilled", () => {
    const waiting = createAgentImportDemoSession()
    const waitingItem = waiting.proposal.items.find((item) => item.id === "demo-new-regulator")
    if (!waitingItem?.template) {
      throw new Error("Mock waiting item is missing its template.")
    }
    const eventId = "demo-template-event-demo-new-regulator"
    const pending = {
      ...waiting,
      proposal: {
        ...waiting.proposal,
        items: waiting.proposal.items.map((item) =>
          item.id === waitingItem.id
            ? { ...item, templateInput: {}, pendingTemplateEventId: eventId, revision: 1 }
            : item
        ),
      },
      events: [
        {
          id: eventId,
          type: "template-input-requested" as const,
          itemId: waitingItem.id,
          revision: 1,
          template: waitingItem.template,
          createdAt: "2030-07-29T08:05:00.000Z",
          status: "open" as const,
        },
      ],
    }
    const fulfilled = {
      ...pending,
      proposal: {
        ...pending.proposal,
        items: pending.proposal.items.map((item) =>
          item.id === waitingItem.id
            ? {
                ...item,
                templateInput: { name: "Mock regulator" },
                pendingTemplateEventId: null,
                revision: 2,
              }
            : item
        ),
      },
      events: pending.events.map((event) => ({ ...event, status: "fulfilled" as const })),
    }
    const pendingItem = pending.proposal.items.find((item) => item.id === waitingItem.id)
    if (!pendingItem) {
      throw new Error("Mock pending item was not created.")
    }

    const drafts = reconcileAgentImportDrafts(
      {
        [pendingItem.id]: {
          item: {
            ...pendingItem,
            material: { ...pendingItem.material, fullName: "Locally edited mock regulator" },
          },
          serverRevision: pendingItem.revision,
        },
      },
      fulfilled
    )

    expect(drafts[pendingItem.id]).toMatchObject({
      serverRevision: 2,
      item: {
        pendingTemplateEventId: null,
        material: { fullName: "Locally edited mock regulator" },
        templateInput: { name: "Mock regulator" },
      },
    })
  })
})
