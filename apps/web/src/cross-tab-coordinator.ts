type LeaseRecord = {
  tabId: string
  expiresAt: string
  updatedAt: string
}

export type CrossTabLeaseState = {
  role: "writer" | "follower" | "unsupported"
  currentTabId: string
  writerTabId: string | null
  leaseExpiresAt: string | null
}

type LeaseListener = (state: CrossTabLeaseState) => void

const CHANNEL_NAME = "tuckmark.cross-tab-coordinator.v1"
const LEASE_STORAGE_KEY = "tuckmark.runtime-writer-lease.v1"
const LEASE_TTL_MS = 15_000
const HEARTBEAT_INTERVAL_MS = 5_000

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseLeaseRecord(raw: string | null): LeaseRecord | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LeaseRecord>
    if (
      typeof parsed.tabId !== "string" ||
      parsed.tabId.length === 0 ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null
    }
    return parsed as LeaseRecord
  } catch {
    return null
  }
}

function isLeaseExpired(record: LeaseRecord | null, now = Date.now()): boolean {
  if (!record) {
    return true
  }
  return Date.parse(record.expiresAt) <= now
}

export class CrossTabCoordinator {
  private readonly tabId = createTabId()
  private readonly listeners = new Set<LeaseListener>()
  private channel: BroadcastChannel | null = null
  private heartbeatTimer: number | null = null
  private started = false
  private state: CrossTabLeaseState = {
    role: "unsupported",
    currentTabId: this.tabId,
    writerTabId: null,
    leaseExpiresAt: null,
  }

  start(): void {
    if (this.started) {
      return
    }
    this.started = true
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      this.setState({
        role: "unsupported",
        currentTabId: this.tabId,
        writerTabId: null,
        leaseExpiresAt: null,
      })
      return
    }

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME)
      this.channel.addEventListener("message", () => {
        this.refreshState()
      })
    }
    window.addEventListener("storage", this.handleStorageEvent)
    this.refreshState(true)
    this.heartbeatTimer = window.setInterval(() => {
      this.refreshState(true)
    }, HEARTBEAT_INTERVAL_MS)
  }

  stop(): void {
    if (!this.started) {
      return
    }
    this.started = false
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", this.handleStorageEvent)
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer)
      }
    }
    this.heartbeatTimer = null
    this.channel?.close()
    this.channel = null
  }

  subscribe(listener: LeaseListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): CrossTabLeaseState {
    return this.state
  }

  async runAsWriter<T>(task: () => Promise<T>): Promise<T> {
    this.refreshState(true)
    if (this.state.role !== "writer") {
      throw new Error("当前标签未持有数据写入租约，请先在系统页接管写入。")
    }
    const result = await task()
    this.broadcastState()
    return result
  }

  requestTakeover(): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return
    }
    this.writeLease()
    this.refreshState()
  }

  private readonly handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== LEASE_STORAGE_KEY) {
      return
    }
    this.refreshState()
  }

  private readLease(): LeaseRecord | null {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return null
    }
    return parseLeaseRecord(window.localStorage.getItem(LEASE_STORAGE_KEY))
  }

  private writeLease(): LeaseRecord {
    const record: LeaseRecord = {
      tabId: this.tabId,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
    }
    window.localStorage.setItem(LEASE_STORAGE_KEY, JSON.stringify(record))
    return record
  }

  private refreshState(preferAcquire = false): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      this.setState({
        role: "unsupported",
        currentTabId: this.tabId,
        writerTabId: null,
        leaseExpiresAt: null,
      })
      return
    }

    let lease = this.readLease()
    if (preferAcquire && (isLeaseExpired(lease) || lease?.tabId === this.tabId)) {
      lease = this.writeLease()
      this.broadcastState()
    }

    if (lease && !isLeaseExpired(lease)) {
      this.setState({
        role: lease.tabId === this.tabId ? "writer" : "follower",
        currentTabId: this.tabId,
        writerTabId: lease.tabId,
        leaseExpiresAt: lease.expiresAt,
      })
      return
    }

    if (preferAcquire) {
      const nextLease = this.writeLease()
      this.broadcastState()
      this.setState({
        role: "writer",
        currentTabId: this.tabId,
        writerTabId: nextLease.tabId,
        leaseExpiresAt: nextLease.expiresAt,
      })
      return
    }

    this.setState({
      role: "follower",
      currentTabId: this.tabId,
      writerTabId: null,
      leaseExpiresAt: null,
    })
  }

  private broadcastState(): void {
    this.channel?.postMessage({
      type: "lease-updated",
      at: new Date().toISOString(),
      tabId: this.tabId,
    })
  }

  private setState(next: CrossTabLeaseState): void {
    const changed =
      this.state.role !== next.role ||
      this.state.writerTabId !== next.writerTabId ||
      this.state.leaseExpiresAt !== next.leaseExpiresAt
    this.state = next
    if (!changed) {
      return
    }
    for (const listener of this.listeners) {
      listener(next)
    }
  }
}

let sharedCoordinator: CrossTabCoordinator | null = null

export function getSharedCrossTabCoordinator(): CrossTabCoordinator {
  if (!sharedCoordinator) {
    sharedCoordinator = new CrossTabCoordinator()
  }
  return sharedCoordinator
}
