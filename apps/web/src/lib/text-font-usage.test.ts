// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"

import {
  clearTextFontUsageState,
  getCommonTextFontFamilies,
  loadTextFontUsageState,
  persistTextFontUsageState,
  recordTextFontRecentUse,
  recordTextFontUsageDuration,
} from "./text-font-usage.js"

function installMemoryStorage() {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.get(key) ?? null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(key)
    },
    setItem(key, value) {
      store.set(key, value)
    },
  }

  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: memoryStorage,
      configurable: true,
      writable: true,
    })
  }
}

function removeStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    value: undefined,
    configurable: true,
    writable: true,
  })
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: undefined,
      configurable: true,
      writable: true,
    })
  }
}

describe("text font usage", () => {
  beforeEach(() => {
    installMemoryStorage()
    clearTextFontUsageState()
  })

  it("combines recent and longest-used fonts into up to five common fonts", () => {
    persistTextFontUsageState({
      fonts: {
        ...loadTextFontUsageState().fonts,
        arial: {
          id: "arial",
          lastUsedAt: "2026-07-08T01:00:00.000Z",
          totalUsedMs: 1_000,
        },
        "ibm-plex-mono": {
          id: "ibm-plex-mono",
          lastUsedAt: "2026-07-08T05:00:00.000Z",
          totalUsedMs: 100,
        },
        "noto-sans-sc": {
          id: "noto-sans-sc",
          lastUsedAt: "2026-07-08T04:00:00.000Z",
          totalUsedMs: 10_000,
        },
        "space-grotesk": {
          id: "space-grotesk",
          lastUsedAt: "2026-07-08T03:00:00.000Z",
          totalUsedMs: 9_000,
        },
        "source-serif-4": {
          id: "source-serif-4",
          lastUsedAt: "2026-07-08T02:00:00.000Z",
          totalUsedMs: 8_000,
        },
        "roboto-condensed": {
          id: "roboto-condensed",
          lastUsedAt: null,
          totalUsedMs: 7_000,
        },
      },
    })

    expect(getCommonTextFontFamilies(loadTextFontUsageState())).toEqual([
      "ibm-plex-mono",
      "noto-sans-sc",
      "space-grotesk",
      "source-serif-4",
      "arial",
    ])
  })

  it("records both recent use and cumulative duration against resolved named fonts", () => {
    recordTextFontRecentUse("system-sans", new Date("2026-07-08T06:00:00.000Z"))
    recordTextFontUsageDuration("system-sans", 2_500, new Date("2026-07-08T06:05:00.000Z"))

    const state = loadTextFontUsageState()
    expect(state.fonts.arial.lastUsedAt).toBe("2026-07-08T06:05:00.000Z")
    expect(state.fonts.arial.totalUsedMs).toBe(2_500)
    expect(getCommonTextFontFamilies(state)).toContain("arial")
  })

  it("falls back to in-memory usage tracking when storage is unavailable", () => {
    removeStorage()

    recordTextFontRecentUse("ibm-plex-mono", new Date("2026-07-08T06:00:00.000Z"))
    recordTextFontUsageDuration("ibm-plex-mono", 1_500, new Date("2026-07-08T06:05:00.000Z"))

    const state = loadTextFontUsageState()
    expect(state.fonts["ibm-plex-mono"].lastUsedAt).toBe("2026-07-08T06:05:00.000Z")
    expect(state.fonts["ibm-plex-mono"].totalUsedMs).toBe(1_500)
    expect(getCommonTextFontFamilies(state)).toEqual(["ibm-plex-mono"])
  })
})
