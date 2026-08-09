// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CrossTabCoordinator, RuntimeDataSourceChangedError } from "./cross-tab-coordinator.js"

const replacementStorageKey = "tuckmark.runtime-replacement.v1"

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key) {
      return entries.get(key) ?? null
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null
    },
    removeItem(key) {
      entries.delete(key)
    },
    setItem(key, value) {
      entries.set(key, value)
    },
  }
}

let storage: Storage

function installQueueingLocks(): void {
  let active = false
  const queue: Array<{
    callback: () => Promise<unknown>
    reject: (reason?: unknown) => void
    resolve: (value: unknown) => void
  }> = []

  const drain = () => {
    if (active) {
      return
    }
    const next = queue.shift()
    if (!next) {
      return
    }
    active = true
    void next
      .callback()
      .then(next.resolve, next.reject)
      .finally(() => {
        active = false
        drain()
      })
  }

  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, callback: () => Promise<unknown>) =>
        new Promise<unknown>((resolve, reject) => {
          queue.push({ callback, reject, resolve })
          drain()
        }),
    },
  })
}

describe("CrossTabCoordinator runtime replacement", () => {
  const coordinators: CrossTabCoordinator[] = []

  beforeEach(() => {
    storage = createMemoryStorage()
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    })
  })

  afterEach(() => {
    for (const coordinator of coordinators.splice(0)) {
      coordinator.stop()
    }
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    })
    storage.clear()
  })

  it("blocks a second writer while a runtime replacement is active", async () => {
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    await primary.runExclusiveRuntimeReplacement(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: replacementStorageKey }))
      expect(secondary.getRuntimeReplacementState().active).toBe(true)
      secondary.requestTakeover()
      await expect(secondary.runAsWriter(async () => "write")).rejects.toThrow("数据源已切换")
    })

    window.dispatchEvent(new StorageEvent("storage", { key: replacementStorageKey }))
    expect(primary.getRuntimeReplacementState()).toMatchObject({
      active: false,
      generation: 1,
    })
    expect(secondary.getRuntimeReplacementState()).toMatchObject({
      active: false,
      generation: 1,
    })
  })

  it("releases a draft-check lock without advancing the data generation", async () => {
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    const result = await primary.runExclusiveRuntimeReplacement(
      async () => ({ drafts: ["pending"] }),
      { didReplace: (outcome) => outcome.drafts.length === 0 }
    )

    window.dispatchEvent(new StorageEvent("storage", { key: replacementStorageKey }))
    expect(result.drafts).toEqual(["pending"])
    expect(primary.getRuntimeReplacementState()).toMatchObject({
      active: false,
      generation: 0,
    })
    expect(secondary.getRuntimeReplacementState()).toMatchObject({
      active: false,
      generation: 0,
    })
  })

  it("serializes a replacement behind an in-flight fallback runtime access", async () => {
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    let releaseAccess: () => void = () => undefined
    let accessEntered: () => void = () => undefined
    const accessReady = new Promise<void>((resolve) => {
      accessEntered = resolve
    })
    const accessGate = new Promise<void>((resolve) => {
      releaseAccess = resolve
    })
    const access = secondary.runRuntimeAccess(async () => {
      accessEntered()
      await accessGate
      return "accessed"
    })
    await accessReady

    let replacementRan = false
    const replacement = primary.runExclusiveRuntimeReplacement(async () => {
      replacementRan = true
      return "replaced"
    })
    await new Promise((resolve) => window.setTimeout(resolve, 40))
    expect(replacementRan).toBe(false)

    releaseAccess()
    await expect(access).resolves.toBe("accessed")
    await expect(replacement).resolves.toBe("replaced")
    expect(replacementRan).toBe(true)
  })

  it("serializes ordinary runtime mutations behind another tab's mutation", async () => {
    installQueueingLocks()
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    let releaseMutation: () => void = () => undefined
    let mutationEntered: () => void = () => undefined
    const mutationReady = new Promise<void>((resolve) => {
      mutationEntered = resolve
    })
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve
    })
    const initialMutation = secondary.runRuntimeMutation(async () => {
      mutationEntered()
      await mutationGate
      return "first mutation"
    })
    await mutationReady

    let secondMutationRan = false
    const secondMutation = primary.runRuntimeMutation(async () => {
      secondMutationRan = true
      return "second mutation"
    })
    await new Promise((resolve) => window.setTimeout(resolve, 40))
    expect(secondMutationRan).toBe(false)

    releaseMutation()
    await expect(initialMutation).resolves.toBe("first mutation")
    await expect(secondMutation).resolves.toBe("second mutation")
    expect(secondMutationRan).toBe(true)
  })

  it("allows nested fallback access in the same coordinator", async () => {
    const coordinator = new CrossTabCoordinator()
    coordinators.push(coordinator)
    coordinator.start()

    await expect(
      coordinator.runRuntimeAccess(
        async () => await coordinator.runRuntimeAccess(async () => "nested access")
      )
    ).resolves.toBe("nested access")
  })

  it("cancels an older queued runtime request after a replacement changes generation", async () => {
    installQueueingLocks()
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    let releaseInitialRead: () => void = () => undefined
    let initialReadEntered: () => void = () => undefined
    const initialReadReady = new Promise<void>((resolve) => {
      initialReadEntered = resolve
    })
    const initialReadGate = new Promise<void>((resolve) => {
      releaseInitialRead = resolve
    })
    const initialRead = secondary.runRuntimeAccess(async () => {
      initialReadEntered()
      await initialReadGate
      return "initial"
    })
    await initialReadReady

    const replacement = primary.runExclusiveRuntimeReplacement(async () => "replaced")
    let staleRequestRan = false
    const staleRequest = secondary.runRuntimeAccess(async () => {
      staleRequestRan = true
      return "stale"
    })

    releaseInitialRead()
    await expect(initialRead).resolves.toBe("initial")
    await expect(replacement).resolves.toBe("replaced")
    await expect(staleRequest).rejects.toBeInstanceOf(RuntimeDataSourceChangedError)
    expect(staleRequestRan).toBe(false)
  })

  it("rechecks writer ownership after an exclusive replacement waits for access", async () => {
    installQueueingLocks()
    const primary = new CrossTabCoordinator()
    const secondary = new CrossTabCoordinator()
    coordinators.push(primary, secondary)
    primary.start()
    secondary.start()

    let releaseAccess: () => void = () => undefined
    let accessEntered: () => void = () => undefined
    const accessReady = new Promise<void>((resolve) => {
      accessEntered = resolve
    })
    const accessGate = new Promise<void>((resolve) => {
      releaseAccess = resolve
    })
    const access = secondary.runRuntimeAccess(async () => {
      accessEntered()
      await accessGate
      return "accessed"
    })
    await accessReady

    let replacementRan = false
    const replacement = primary.runExclusiveRuntimeReplacement(async () => {
      replacementRan = true
      return "replaced"
    })
    secondary.requestTakeover()

    releaseAccess()
    await expect(access).resolves.toBe("accessed")
    await expect(replacement).rejects.toThrow("当前标签未持有数据写入租约")
    expect(replacementRan).toBe(false)
  })
})
