import type { AppMode } from "./types.js"

let runtimeDataMode: AppMode | null = null

export function setRuntimeDataMode(mode: AppMode | null): void {
  runtimeDataMode = mode
}

export function isDemoRuntimeMode(): boolean {
  return runtimeDataMode === "demo"
}

export function getRuntimeDataMode(): AppMode | null {
  return runtimeDataMode
}
