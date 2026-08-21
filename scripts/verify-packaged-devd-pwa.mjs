#!/usr/bin/env node

import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"

import { chromium } from "playwright"

function readOption(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) throw new Error(`Missing required option ${name}`)
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return value
}

async function reserveEphemeralPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Could not allocate a port")
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`tuckmark-devd exited with ${child.exitCode}: ${output.join("")}`)
    }
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
      lastError = new Error(`health returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`tuckmark-devd did not become healthy: ${String(lastError)}`)
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (child.exitCode === null) child.kill("SIGKILL")
}

async function waitForWorker(page) {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const registration = await page.evaluate(async () => {
        const value = await navigator.serviceWorker.ready
        return { scope: value.scope, active: Boolean(value.active) }
      })
      if (registration.active) return registration
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Packaged DEVD service worker did not activate: ${String(lastError)}`)
}

async function main() {
  const devd = path.resolve(readOption("--devd"))
  const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "tuckmark-packaged-pwa-"))
  const port = await reserveEphemeralPort()
  const runtimeDir = path.join(smokeRoot, "runtime")
  const output = []
  await mkdir(runtimeDir, { recursive: true })
  const child = spawn(devd, [], {
    cwd: smokeRoot,
    env: {
      ...process.env,
      PATH: "",
      PORT: String(port),
      TUCKMARK_DATA_DIR: path.join(smokeRoot, "data"),
      TUCKMARK_DEVD_INSTANCE: `packaged-pwa-${process.pid}`,
      TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "true",
      XDG_RUNTIME_DIR: runtimeDir,
    },
    stdio: "pipe",
  })
  child.stdout?.on("data", (chunk) => output.push(String(chunk)))
  child.stderr?.on("data", (chunk) => output.push(String(chunk)))
  let browser
  try {
    browser = await chromium.launch()
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHealth(baseUrl, child, output)
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${baseUrl}/packaged-pwa/deep-link`, { waitUntil: "domcontentloaded" })
    const registration = await waitForWorker(page)
    if (registration.scope !== `${baseUrl}/`) {
      throw new Error(`Expected root service-worker scope, got ${registration.scope}`)
    }
    const cacheReady = await page.evaluate(async () => {
      const names = await caches.keys()
      for (const name of names.filter((value) => value.startsWith("tuckmark-app-"))) {
        const marker = await (await caches.open(name)).match("/__tuckmark-cache-ready__")
        if (marker) return true
      }
      return false
    })
    if (!cacheReady) throw new Error("Packaged DEVD cache-ready marker was missing")

    const onlineApiStatus = await page.evaluate(async () => (await fetch("/api/data/status")).ok)
    if (!onlineApiStatus) throw new Error("Packaged DEVD API request failed while online")
    await context.setOffline(true)
    await page.reload({ waitUntil: "domcontentloaded" })
    if ((await page.title()) !== "Tuckmark") {
      throw new Error("Cached packaged DEVD Web shell did not load offline")
    }
    const offlineApiFailed = await page.evaluate(async () => {
      try {
        await fetch("/api/data/status")
        return false
      } catch {
        return true
      }
    })
    if (!offlineApiFailed) throw new Error("PWA unexpectedly served DEVD API data offline")
    await context.close()
  } finally {
    await browser?.close()
    await stop(child)
    await rm(smokeRoot, { recursive: true, force: true })
  }
  console.log(JSON.stringify({ packagedDevdPwa: "passed" }))
}

await main()
