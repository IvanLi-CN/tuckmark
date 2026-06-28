import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { emptySyncState, mergeSyncState, parseSyncState, type SyncState } from "./sync-state.js"

export class SyncStateStore {
  readonly root: string
  #writeChain: Promise<unknown> = Promise.resolve()

  constructor(root?: string) {
    this.root = root ?? path.resolve(process.cwd(), ".tuckmark")
  }

  private statePath(): string {
    return path.join(this.root, "sync-state.json")
  }

  private tempStatePath(): string {
    return path.join(this.root, "sync-state.json.tmp")
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  async readState(): Promise<SyncState> {
    await this.ensure()
    try {
      const raw = await readFile(this.statePath(), "utf8")
      return parseSyncState(JSON.parse(raw))
    } catch {
      return emptySyncState()
    }
  }

  async writeState(state: SyncState): Promise<SyncState> {
    await this.ensure()
    const normalized = parseSyncState(state)
    const nextJson = `${JSON.stringify(normalized, null, 2)}\n`
    await writeFile(this.tempStatePath(), nextJson, "utf8")
    await rename(this.tempStatePath(), this.statePath())
    return normalized
  }

  async mergeState(next: SyncState): Promise<SyncState> {
    const run = async () => {
      const current = await this.readState()
      const merged = mergeSyncState(current, next)
      return this.writeState({
        ...merged,
        updatedAt: new Date().toISOString(),
      })
    }

    const result = this.#writeChain.then(run, run)
    this.#writeChain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
