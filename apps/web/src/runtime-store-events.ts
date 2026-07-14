export type RuntimeStoreMutationReason =
  | "template-saved"
  | "autosave-saved"
  | "working-copy-replaced"
  | "working-copy-cleared"
  | "template-autosaves-cleared"
  | "app-settings-saved"
  | "snapshot-replaced"

export type RuntimeStoreMutationEvent = {
  at: string
  originTabId: string
  reason: RuntimeStoreMutationReason
}

type MutationListener = (event: RuntimeStoreMutationEvent) => void

const CHANNEL_NAME = "tuckmark.runtime-store-events.v1"
const TAB_ID = (() => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`
})()

const listeners = new Set<MutationListener>()
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    return null
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.addEventListener("message", (event: MessageEvent<RuntimeStoreMutationEvent>) => {
      const payload = event.data
      if (!payload || typeof payload !== "object") {
        return
      }
      for (const listener of listeners) {
        listener(payload)
      }
    })
  }
  return channel
}

export function getRuntimeStoreEventTabId(): string {
  return TAB_ID
}

export function emitRuntimeStoreMutation(
  reason: RuntimeStoreMutationReason
): RuntimeStoreMutationEvent {
  const payload: RuntimeStoreMutationEvent = {
    at: new Date().toISOString(),
    originTabId: TAB_ID,
    reason,
  }
  for (const listener of listeners) {
    listener(payload)
  }
  getChannel()?.postMessage(payload)
  return payload
}

export function subscribeRuntimeStoreMutations(listener: MutationListener): () => void {
  listeners.add(listener)
  getChannel()
  return () => {
    listeners.delete(listener)
  }
}
