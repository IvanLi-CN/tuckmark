// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildCanvasDimensionOptions,
  clearRecentCanvasDimensions,
  formatCanvasDimension,
  getCanvasDimensionCapabilityMessage,
  getCanvasDotsCapabilityMessage,
  loadRecentCanvasDimensions,
  recordRecentCanvasDimension,
} from "./canvas-dimensions.js"

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
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
}

function installLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  })
}

describe("canvas dimension history", () => {
  beforeEach(() => {
    installLocalStorage(createMemoryStorage())
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    clearRecentCanvasDimensions()
  })

  it("records dimensions newest first and dedupes by width-height pair", () => {
    recordRecentCanvasDimension({ width: 48, height: 28 })
    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"))
    recordRecentCanvasDimension({ width: 40, height: 16 })
    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"))
    recordRecentCanvasDimension({ width: 48, height: 28 })

    expect(loadRecentCanvasDimensions().map(({ width, height }) => `${width}x${height}`)).toEqual([
      "48x28",
      "40x16",
    ])
  })

  it("builds visible options from recent dimensions first, then preset dimensions", () => {
    const options = buildCanvasDimensionOptions(
      [
        { width: 64, height: 30, usedAt: "2026-01-01T00:02:00.000Z" },
        { width: 48, height: 28, usedAt: "2026-01-01T00:01:00.000Z" },
      ],
      [
        { id: "shipping-wide", name: "快递单宽版", width: 48, height: 28, description: "" },
        { id: "ops-tag", name: "机柜标签", width: 48, height: 20, description: "" },
      ]
    )

    expect(options).toEqual([
      { width: 64, height: 30 },
      { width: 48, height: 28 },
      { width: 48, height: 20 },
    ])
  })

  it("formats canvas dimensions as physical millimeters", () => {
    expect(formatCanvasDimension({ width: 64, height: 30 })).toBe("64 × 30 mm")
  })

  it("reports when a canvas exceeds the print target width", () => {
    expect(getCanvasDimensionCapabilityMessage({ width: 64, height: 30 }, 384)).toContain(
      "当前画布宽度 64 mm 超过打印目标宽度 48 mm"
    )
    expect(getCanvasDimensionCapabilityMessage({ width: 48, height: 30 }, 384)).toBeNull()
    expect(getCanvasDotsCapabilityMessage(512, 384)).toContain(
      "当前画布宽度 64 mm 超过打印目标宽度 48 mm"
    )
    expect(getCanvasDotsCapabilityMessage(384, 384)).toBeNull()
  })
})
