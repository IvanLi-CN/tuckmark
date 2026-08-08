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

export type CanvasDraftSession = {
  tabId: string
  sourceKey: string
  updatedAt: string
}

type CanvasDraftSessionRecord = {
  version: 1
  sessions: CanvasDraftSession[]
}

export type CanvasDraftAttentionRequest = {
  sourceKey: string
  requestedAt: string
  requesterTabId: string
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
type CanvasDraftSessionListener = (sessions: CanvasDraftSession[]) => void
type CanvasDraftAttentionListener = (request: CanvasDraftAttentionRequest) => void

const CHANNEL_NAME = "tuckmark.cross-tab-coordinator.v1"
const LEASE_STORAGE_KEY = "tuckmark.runtime-writer-lease.v1"
const RUNTIME_REPLACEMENT_STORAGE_KEY = "tuckmark.runtime-replacement.v1"
const RUNTIME_GENERATION_STORAGE_KEY = "tuckmark.runtime-generation.v1"
const CANVAS_DRAFT_SESSIONS_STORAGE_KEY = "tuckmark.canvas-draft-sessions.v1"
const CANVAS_DRAFT_ATTENTION_STORAGE_KEY = "tuckmark.canvas-draft-attention.v1"
const RUNTIME_ACCESS_LOCK_NAME = "tuckmark.runtime-access.v1"
const LEASE_TTL_MS = 15_000
const RUNTIME_REPLACEMENT_TTL_MS = 60_000
const RUNTIME_REPLACEMENT_HEARTBEAT_MS = 15_000
const HEARTBEAT_INTERVAL_MS = 5_000
const CANVAS_DRAFT_SESSION_TTL_MS = 20_000
const CANVAS_DRAFT_SESSION_HEARTBEAT_MS = 5_000

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

function parseRuntimeGeneration(raw: string | null): number {
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function parseCanvasDraftSessionRecord(raw: string | null): CanvasDraftSession[] {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasDraftSessionRecord>
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      return []
    }
    return parsed.sessions.flatMap((session) => {
      if (
        !session ||
        typeof session.tabId !== "string" ||
        typeof session.sourceKey !== "string" ||
        typeof session.updatedAt !== "string"
      ) {
        return []
      }
      return [session]
    })
  } catch {
    return []
  }
}

function parseCanvasDraftAttentionRequest(raw: string | null): CanvasDraftAttentionRequest | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasDraftAttentionRequest>
    if (
      typeof parsed.sourceKey !== "string" ||
      typeof parsed.requestedAt !== "string" ||
      typeof parsed.requesterTabId !== "string"
    ) {
      return null
    }
    return parsed as CanvasDraftAttentionRequest
  } catch {
    return null
  }
}

function getActiveCanvasDraftSessions(
  sessions: CanvasDraftSession[],
  now = Date.now()
): CanvasDraftSession[] {
  return sessions.filter((session) => {
    const updatedAt = Date.parse(session.updatedAt)
    return Number.isFinite(updatedAt) && updatedAt + CANVAS_DRAFT_SESSION_TTL_MS > now
  })
}

function sameCanvasDraftSessions(left: CanvasDraftSession[], right: CanvasDraftSession[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every(
    (session, index) =>
      session.tabId === right[index]?.tabId && session.sourceKey === right[index]?.sourceKey
  )
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
  private readonly canvasDraftSessionListeners = new Set<CanvasDraftSessionListener>()
  private readonly canvasDraftAttentionListeners = new Set<CanvasDraftAttentionListener>()
  private channel: BroadcastChannel | null = null
  private heartbeatTimer: number | null = null
  private canvasDraftSessionHeartbeatTimer: number | null = null
  private activeCanvasDraftSourceKey: string | null = null
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
  private canvasDraftSessions: CanvasDraftSession[] = []

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
      this.channel.addEventListener("message", this.handleCoordinatorMessage)
    }
    window.addEventListener("storage", this.handleStorageEvent)
    this.refreshState(true)
    this.refreshRuntimeReplacementState()
    this.refreshCanvasDraftSessions()
    this.heartbeatTimer = window.setInterval(() => {
      this.refreshState(true)
      this.refreshRuntimeReplacementState()
      this.refreshCanvasDraftSessions()
    }, HEARTBEAT_INTERVAL_MS)
  }

  stop(): void {
    if (!this.started) {
      return
    }
    this.started = false
    this.clearActiveCanvasDraftSession()
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", this.handleStorageEvent)
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer)
      }
    }
    this.heartbeatTimer = null
    this.channel?.removeEventListener("message", this.handleCoordinatorMessage)
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

  subscribeCanvasDraftSessions(listener: CanvasDraftSessionListener): () => void {
    this.canvasDraftSessionListeners.add(listener)
    listener(this.canvasDraftSessions)
    return () => {
      this.canvasDraftSessionListeners.delete(listener)
    }
  }

  subscribeCanvasDraftAttention(listener: CanvasDraftAttentionListener): () => void {
    this.canvasDraftAttentionListeners.add(listener)
    return () => {
      this.canvasDraftAttentionListeners.delete(listener)
    }
  }

  getCanvasDraftSessions(sourceKey?: string): CanvasDraftSession[] {
    this.refreshCanvasDraftSessions()
    return sourceKey
      ? this.canvasDraftSessions.filter((session) => session.sourceKey === sourceKey)
      : this.canvasDraftSessions
  }

  registerCanvasDraftSession(sourceKey: string): () => void {
    if (!sourceKey) {
      return () => undefined
    }
    this.start()
    this.clearActiveCanvasDraftSession()
    this.activeCanvasDraftSourceKey = sourceKey
    this.publishActiveCanvasDraftSession()
    if (typeof window !== "undefined") {
      this.canvasDraftSessionHeartbeatTimer = window.setInterval(() => {
        this.publishActiveCanvasDraftSession()
      }, CANVAS_DRAFT_SESSION_HEARTBEAT_MS)
    }
    return () => {
      if (this.activeCanvasDraftSourceKey === sourceKey) {
        this.clearActiveCanvasDraftSession()
      }
    }
  }

  requestCanvasDraftAttention(sourceKey: string): void {
    if (!sourceKey || typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return
    }
    const request: CanvasDraftAttentionRequest = {
      sourceKey,
      requestedAt: new Date().toISOString(),
      requesterTabId: this.tabId,
    }
    window.localStorage.setItem(CANVAS_DRAFT_ATTENTION_STORAGE_KEY, JSON.stringify(request))
    this.channel?.postMessage({ type: "canvas-draft-attention", request })
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

  async runExclusiveRuntimeReplacement<T>(task: () => Promise<T>): Promise<T> {
    this.refreshState(true)
    if (this.state.role !== "writer") {
      throw new Error("当前标签未持有数据写入租约，请先在系统页接管写入。")
    }
    return await this.withRuntimeAccessLock("exclusive", async () => {
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
        this.writeRuntimeGeneration(this.runtimeReplacementState.generation + 1)
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

  private readonly handleCoordinatorMessage = (event: MessageEvent<unknown>) => {
    const payload = event.data
    if (
      payload &&
      typeof payload === "object" &&
      "type" in payload &&
      payload.type === "canvas-draft-attention" &&
      "request" in payload
    ) {
      const request = payload.request
      if (
        request &&
        typeof request === "object" &&
        "sourceKey" in request &&
        "requestedAt" in request &&
        "requesterTabId" in request &&
        typeof request.sourceKey === "string" &&
        typeof request.requestedAt === "string" &&
        typeof request.requesterTabId === "string"
      ) {
        this.notifyCanvasDraftAttention(request as CanvasDraftAttentionRequest)
      }
      return
    }
    this.refreshState()
    this.refreshRuntimeReplacementState()
    this.refreshCanvasDraftSessions()
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
      return
    }
    if (event.key === CANVAS_DRAFT_SESSIONS_STORAGE_KEY) {
      this.refreshCanvasDraftSessions()
      return
    }
    if (event.key === CANVAS_DRAFT_ATTENTION_STORAGE_KEY) {
      const request = parseCanvasDraftAttentionRequest(event.newValue)
      if (request) {
        this.notifyCanvasDraftAttention(request)
      }
    }
  }

  private readCanvasDraftSessions(): CanvasDraftSession[] {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return []
    }
    return getActiveCanvasDraftSessions(
      parseCanvasDraftSessionRecord(window.localStorage.getItem(CANVAS_DRAFT_SESSIONS_STORAGE_KEY))
    )
  }

  private writeCanvasDraftSessions(sessions: CanvasDraftSession[]): void {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return
    }
    window.localStorage.setItem(
      CANVAS_DRAFT_SESSIONS_STORAGE_KEY,
      JSON.stringify({ version: 1, sessions } satisfies CanvasDraftSessionRecord)
    )
  }

  private publishActiveCanvasDraftSession(): void {
    const sourceKey = this.activeCanvasDraftSourceKey
    if (!sourceKey) {
      return
    }
    const sessions = this.readCanvasDraftSessions().filter(
      (session) => session.tabId !== this.tabId
    )
    sessions.push({
      tabId: this.tabId,
      sourceKey,
      updatedAt: new Date().toISOString(),
    })
    this.writeCanvasDraftSessions(sessions)
    this.refreshCanvasDraftSessions()
    this.broadcastState()
  }

  private clearActiveCanvasDraftSession(): void {
    if (this.canvasDraftSessionHeartbeatTimer !== null && typeof window !== "undefined") {
      window.clearInterval(this.canvasDraftSessionHeartbeatTimer)
    }
    this.canvasDraftSessionHeartbeatTimer = null
    if (!this.activeCanvasDraftSourceKey) {
      return
    }
    const sessions = this.readCanvasDraftSessions().filter(
      (session) => session.tabId !== this.tabId
    )
    this.activeCanvasDraftSourceKey = null
    this.writeCanvasDraftSessions(sessions)
    this.refreshCanvasDraftSessions()
    this.broadcastState()
  }

  private refreshCanvasDraftSessions(): void {
    const next = this.readCanvasDraftSessions().sort((left, right) =>
      left.tabId.localeCompare(right.tabId)
    )
    if (sameCanvasDraftSessions(this.canvasDraftSessions, next)) {
      this.canvasDraftSessions = next
      return
    }
    this.canvasDraftSessions = next
    for (const listener of this.canvasDraftSessionListeners) {
      listener(next)
    }
  }

  private notifyCanvasDraftAttention(request: CanvasDraftAttentionRequest): void {
    if (request.requesterTabId === this.tabId) {
      return
    }
    for (const listener of this.canvasDraftAttentionListeners) {
      listener(request)
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
      return await task()
    }
    return await navigator.locks.request(RUNTIME_ACCESS_LOCK_NAME, { mode }, task)
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
