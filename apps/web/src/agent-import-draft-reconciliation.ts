import type { AgentImportItem, AgentImportSession } from "@tuckmark/inventory"

export type AgentImportItemDraft = {
  item: AgentImportItem
  serverRevision: number
}

function sessionStateRank(state: AgentImportSession["state"]): number {
  return state === "open" ? 0 : 1
}

/** Rejects a late poll that would restore older item revisions or an earlier terminal state. */
export function isCurrentAgentImportSession(
  next: AgentImportSession,
  current: AgentImportSession
): boolean {
  if (next.id !== current.id || sessionStateRank(next.state) < sessionStateRank(current.state)) {
    return false
  }
  const nextItems = new Map(next.proposal.items.map((item) => [item.id, item]))
  return current.proposal.items.every((item) => {
    const nextItem = nextItems.get(item.id)
    return Boolean(nextItem && nextItem.revision >= item.revision)
  })
}

/** Preserves local non-template edits while an Agent fulfills the matching template event. */
export function reconcileAgentImportDrafts(
  current: Record<string, AgentImportItemDraft>,
  session: AgentImportSession
): Record<string, AgentImportItemDraft> {
  const next: Record<string, AgentImportItemDraft> = {}
  for (const item of session.proposal.items) {
    const previous = current[item.id]
    const fulfilledEvent = previous?.item.pendingTemplateEventId
      ? session.events.find(
          (event) =>
            event.id === previous.item.pendingTemplateEventId &&
            event.itemId === item.id &&
            event.status === "fulfilled"
        )
      : undefined
    next[item.id] =
      previous && previous.serverRevision === item.revision
        ? previous
        : {
            item: fulfilledEvent
              ? {
                  ...item,
                  selected: previous.item.selected,
                  material: previous.item.material,
                  quantity: previous.item.quantity,
                  labelPrintQuantity: previous.item.labelPrintQuantity,
                  sourceNote: previous.item.sourceNote,
                  needsAttention: previous.item.needsAttention,
                }
              : item,
            serverRevision: item.revision,
          }
  }
  return next
}
