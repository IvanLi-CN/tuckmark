type LeaseRecord = {
  tabId: string
  expiresAt: string
  updatedAt: string
}

type RuntimeReplacementRecord = {
  operationId: string
  tabId: string
  expiresAt: string
  updatedAt: string
}

type RuntimeAccessFallbackLockRecord = {
  operationId: string
  tabId: string
  expiresAt: string
}

export type CrossTabLeaseState = {
  role: "writer" | "follower" | "unsupported"
  currentTabId: string
  writerTabId: string | null
  leaseExpiresAt: string | null
}

export type RuntimeReplacementState = {
  active: boolean
  currentTabId: string
  generation: number
  operationId: string | null
  ownerTabId: string | null
}

type LeaseListener = (state: CrossTabLeaseState) => void
type RuntimeReplacementListener = (state: RuntimeReplacementState) => void

const CHANNEL_NAME = "tuckmark.cross-tab-coordinator.v1"
const LEASE_STORAGE_KEY = "tuckmark.runtime-writer-lease.v1"
const RUNTIME_REPLACEMENT_STORAGE_KEY = "tuckmark.runtime-replacement.v1"
const RUNTIME_GENERATION_STORAGE_KEY = "tuckmark.runtime-generation.v1"
const RUNTIME_ACCESS_LOCK_NAME = "tuckmark.runtime-access.v1"
const RUNTIME_ACCESS_FALLBACK_LOCK_STORAGE_KEY = "tuckmark.runtime-access-fallback.v1"
const LEASE_TTL_MS = 15_000
const RUNTIME_REPLACEMENT_TTL_MS = 60_000
const RUNTIME_REPLACEMENT_HEARTBEAT_MS = 15_000
const RUNTIME_ACCESS_FALLBACK_LOCK_TTL_MS = 60_000
const RUNTIME_ACCESS_FALLBACK_LOCK_RETRY_MS = 4
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

function parseRuntimeReplacementRecord(raw: string | null): RuntimeReplacementRecord | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeReplacementRecord>
    if (
      typeof parsed.operationId !== "string" ||
      typeof parsed.tabId !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null
    }
    return parsed as RuntimeReplacementRecord
  } catch {
    return null
  }
}

function isRuntimeReplacementExpired(
  record: RuntimeReplacementRecord | null,
  now = Date.now()
): boolean {
  return !record || Date.parse(record.expiresAt) <= now
}

function parseRuntimeAccessFallbackLockRecord(
  raw: string | null
): RuntimeAccessFallbackLockRecord | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeAccessFallbackLockRecord>
    if (
      typeof parsed.operationId !== "string" ||
      typeof parsed.tabId !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null
    }
    return parsed as RuntimeAccessFallbackLockRecord
  } catch {
    return null
  }
}

function isRuntimeAccessFallbackLockExpired(
  record: RuntimeAccessFallbackLockRecord | null,
  now = Date.now()
): boolean {
  return !record || Date.parse(record.expiresAt) <= now
}

function waitForFallbackLockRetry(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, RUNTIME_ACCESS_FALLBACK_LOCK_RETRY_MS)
  })
}

function parseRuntimeGeneration(raw: string | null): number {
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export class RuntimeDataSourceChangedError extends Error {
  constructor() {
    super("数据源已切换，请在最新数据集上重试。")
    this.name = "RuntimeDataSourceChangedError"
  }
}

export class CrossTabCoordinator {
  private readonly tabId = createTabId()
  private readonly listeners = new Set<LeaseListener>()
  private readonly runtimeReplacementListeners = new Set<RuntimeReplacementListener>()
  private channel: BroadcastChannel | null = null
  private heartbeatTimer: number | null = null
  private started = false
  private state: CrossTabLeaseState = {
    role: "unsupported",
    currentTabId: this.tabId,
    writerTabId: null,
    leaseExpiresAt: null,
  }
  private runtimeReplacementState: RuntimeReplacementState = {
    active: false,
    currentTabId: this.tabId,
    generation: 0,
    operationId: null,
    ownerTabId: null,
  }
  private fallbackRuntimeAccessLock: {
    record: RuntimeAccessFallbackLockRecord
    depth: number
    heartbeat: number
  } | null = null

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
        this.refreshRuntimeReplacementState()
      })
    }
    window.addEventListener("storage", this.handleStorageEvent)
    this.refreshState(true)
    this.refreshRuntimeReplacementState()
    this.heartbeatTimer = window.setInterval(() => {
      this.refreshState(true)
      this.refreshRuntimeReplacementState()
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

  subscribeRuntimeReplacement(listener: RuntimeReplacementListener): () => void {
    this.runtimeReplacementListeners.add(listener)
    listener(this.runtimeReplacementState)
    return () => {
      this.runtimeReplacementListeners.delete(listener)
    }
  }

  getState(): CrossTabLeaseState {
    return this.state
  }

  getRuntimeReplacementState(): RuntimeReplacementState {
    return this.runtimeReplacementState
  }

  isRuntimeReplacementOwner(): boolean {
    return (
      this.runtimeReplacementState.active && this.runtimeReplacementState.ownerTabId === this.tabId
    )
  }

  async runRuntimeAccess<T>(task: () => Promise<T>): Promise<T> {
    this.refreshRuntimeReplacementState()
    const before = this.runtimeReplacementState
    if (before.active && !this.isRuntimeReplacementOwner()) {
      throw new RuntimeDataSourceChangedError()
    }
    if (this.isRuntimeReplacementOwner()) {
      return await task()
    }
    return await this.withRuntimeAccessLock("shared", async () => {
      this.refreshRuntimeReplacementState()
      const current = this.runtimeReplacementState
      if (current.active || current.generation !== before.generation) {
        throw new RuntimeDataSourceChangedError()
      }
      const result = await task()
      this.refreshRuntimeReplacementState()
      if (this.runtimeReplacementState.generation !== before.generation) {
        throw new RuntimeDataSourceChangedError()
      }
      return result
    })
  }

  async runExclusiveRuntimeReplacement<T>(
    task: () => Promise<T>,
    options?: { didReplace?: (result: T) => boolean }
  ): Promise<T> {
    this.refreshState(true)
    if (this.state.role !== "writer") {
      throw new Error("当前标签未持有数据写入租约，请先在系统页接管写入。")
    }
    return await this.withRuntimeAccessLock("exclusive", async () => {
      this.refreshState(true)
      if (this.state.role !== "writer") {
        throw new Error("当前标签未持有数据写入租约，请先在系统页接管写入。")
      }
      this.refreshRuntimeReplacementState()
      if (
        this.runtimeReplacementState.active &&
        this.runtimeReplacementState.ownerTabId !== this.tabId
      ) {
        throw new Error("另一标签正在替换数据集，请等待其完成。")
      }

      const record = this.writeRuntimeReplacement()
      const replacementHeartbeat =
        typeof window === "undefined"
          ? null
          : window.setInterval(() => {
              this.renewRuntimeReplacement(record.operationId)
            }, RUNTIME_REPLACEMENT_HEARTBEAT_MS)
      this.refreshRuntimeReplacementState()
      try {
        const result = await task()
        if (options?.didReplace?.(result) ?? true) {
          this.writeRuntimeGeneration(this.runtimeReplacementState.generation + 1)
        }
        return result
      } finally {
        if (replacementHeartbeat !== null) {
          window.clearInterval(replacementHeartbeat)
        }
        this.clearRuntimeReplacement(record.operationId)
        this.refreshRuntimeReplacementState()
        this.broadcastState()
      }
    })
  }

  async runAsWriter<T>(task: () => Promise<T>): Promise<T> {
    return await this.runRuntimeAccess(async () => {
      this.refreshState(true)
      this.refreshRuntimeReplacementState()
      if (this.state.role !== "writer") {
        throw new Error("当前标签未持有数据写入租约，请先在系统页接管写入。")
      }
      if (this.runtimeReplacementState.active && !this.isRuntimeReplacementOwner()) {
        throw new Error("另一标签正在替换数据集，请等待其完成。")
      }
      const result = await task()
      this.broadcastState()
      return result
    })
  }

  requestTakeover(): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return
    }
    this.writeLease()
    this.refreshState()
  }

  private readonly handleStorageEvent = (event: StorageEvent) => {
    if (event.key === LEASE_STORAGE_KEY) {
      this.refreshState()
      return
    }
    if (
      event.key === RUNTIME_REPLACEMENT_STORAGE_KEY ||
      event.key === RUNTIME_GENERATION_STORAGE_KEY
    ) {
      this.refreshRuntimeReplacementState()
    }
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

  private readRuntimeReplacement(): RuntimeReplacementRecord | null {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return null
    }
    return parseRuntimeReplacementRecord(
      window.localStorage.getItem(RUNTIME_REPLACEMENT_STORAGE_KEY)
    )
  }

  private writeRuntimeReplacement(): RuntimeReplacementRecord {
    const record: RuntimeReplacementRecord = {
      operationId: createTabId(),
      tabId: this.tabId,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + RUNTIME_REPLACEMENT_TTL_MS).toISOString(),
    }
    window.localStorage.setItem(RUNTIME_REPLACEMENT_STORAGE_KEY, JSON.stringify(record))
    this.broadcastState()
    return record
  }

  private clearRuntimeReplacement(operationId: string): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return
    }
    const current = this.readRuntimeReplacement()
    if (current?.operationId === operationId && current.tabId === this.tabId) {
      window.localStorage.removeItem(RUNTIME_REPLACEMENT_STORAGE_KEY)
    }
  }

  private renewRuntimeReplacement(operationId: string): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return
    }
    const current = this.readRuntimeReplacement()
    if (current?.operationId !== operationId || current.tabId !== this.tabId) {
      return
    }
    const updatedAt = new Date().toISOString()
    window.localStorage.setItem(
      RUNTIME_REPLACEMENT_STORAGE_KEY,
      JSON.stringify({
        ...current,
        updatedAt,
        expiresAt: new Date(Date.now() + RUNTIME_REPLACEMENT_TTL_MS).toISOString(),
      } satisfies RuntimeReplacementRecord)
    )
  }

  private writeRuntimeGeneration(next: number): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return
    }
    window.localStorage.setItem(RUNTIME_GENERATION_STORAGE_KEY, String(next))
  }

  private async withRuntimeAccessLock<T>(
    mode: "shared" | "exclusive",
    task: () => Promise<T>
  ): Promise<T> {
    if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") {
      return await this.withRuntimeAccessFallbackLock(task)
    }
    return await navigator.locks.request(RUNTIME_ACCESS_LOCK_NAME, { mode }, task)
  }

  private readRuntimeAccessFallbackLock(): RuntimeAccessFallbackLockRecord | null {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return null
    }
    return parseRuntimeAccessFallbackLockRecord(
      window.localStorage.getItem(RUNTIME_ACCESS_FALLBACK_LOCK_STORAGE_KEY)
    )
  }

  private async withRuntimeAccessFallbackLock<T>(task: () => Promise<T>): Promise<T> {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return await task()
    }

    if (this.fallbackRuntimeAccessLock) {
      this.fallbackRuntimeAccessLock.depth += 1
      try {
        return await task()
      } finally {
        this.fallbackRuntimeAccessLock.depth -= 1
      }
    }

    const operationId = createTabId()
    let record: RuntimeAccessFallbackLockRecord | null = null
    while (!record) {
      const current = this.readRuntimeAccessFallbackLock()
      if (!isRuntimeAccessFallbackLockExpired(current)) {
        await waitForFallbackLockRetry()
        continue
      }

      const candidate: RuntimeAccessFallbackLockRecord = {
        operationId,
        tabId: this.tabId,
        expiresAt: new Date(Date.now() + RUNTIME_ACCESS_FALLBACK_LOCK_TTL_MS).toISOString(),
      }
      window.localStorage.setItem(
        RUNTIME_ACCESS_FALLBACK_LOCK_STORAGE_KEY,
        JSON.stringify(candidate)
      )
      await waitForFallbackLockRetry()
      const confirmed = this.readRuntimeAccessFallbackLock()
      if (confirmed?.operationId === operationId && confirmed.tabId === this.tabId) {
        record = candidate
      }
    }

    const heldLock = {
      record,
      depth: 1,
      heartbeat: window.setInterval(() => {
        const current = this.readRuntimeAccessFallbackLock()
        if (current?.operationId !== record.operationId || current.tabId !== this.tabId) {
          return
        }
        window.localStorage.setItem(
          RUNTIME_ACCESS_FALLBACK_LOCK_STORAGE_KEY,
          JSON.stringify({
            ...current,
            expiresAt: new Date(Date.now() + RUNTIME_ACCESS_FALLBACK_LOCK_TTL_MS).toISOString(),
          } satisfies RuntimeAccessFallbackLockRecord)
        )
      }, RUNTIME_ACCESS_FALLBACK_LOCK_TTL_MS / 2),
    }
    this.fallbackRuntimeAccessLock = heldLock

    try {
      return await task()
    } finally {
      heldLock.depth -= 1
      if (heldLock.depth === 0) {
        window.clearInterval(heldLock.heartbeat)
        const current = this.readRuntimeAccessFallbackLock()
        if (current?.operationId === record.operationId && current.tabId === this.tabId) {
          window.localStorage.removeItem(RUNTIME_ACCESS_FALLBACK_LOCK_STORAGE_KEY)
        }
        if (this.fallbackRuntimeAccessLock === heldLock) {
          this.fallbackRuntimeAccessLock = null
        }
      }
    }
  }

  private refreshRuntimeReplacementState(): void {
    const supported = typeof window !== "undefined" && typeof window.localStorage !== "undefined"
    const record = supported ? this.readRuntimeReplacement() : null
    const activeRecord = isRuntimeReplacementExpired(record) ? null : record
    const generation = supported
      ? parseRuntimeGeneration(window.localStorage.getItem(RUNTIME_GENERATION_STORAGE_KEY))
      : 0
    this.setRuntimeReplacementState({
      active: activeRecord !== null,
      currentTabId: this.tabId,
      generation,
      operationId: activeRecord?.operationId ?? null,
      ownerTabId: activeRecord?.tabId ?? null,
    })
  }

  private broadcastState(): void {
    this.channel?.postMessage({
      type: "coordinator-updated",
      at: new Date().toISOString(),
      tabId: this.tabId,
    })
  }

  private setRuntimeReplacementState(next: RuntimeReplacementState): void {
    const changed =
      this.runtimeReplacementState.active !== next.active ||
      this.runtimeReplacementState.generation !== next.generation ||
      this.runtimeReplacementState.operationId !== next.operationId ||
      this.runtimeReplacementState.ownerTabId !== next.ownerTabId
    this.runtimeReplacementState = next
    if (!changed) {
      return
    }
    for (const listener of this.runtimeReplacementListeners) {
      listener(next)
    }
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
