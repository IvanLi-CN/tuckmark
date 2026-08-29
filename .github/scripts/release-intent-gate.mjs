#!/usr/bin/env node

import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { assertReleasableReleaseIntent } from "./release-intent.mjs"

export function classifyReleaseIntent(snapshot, expectedIntentId = "") {
  const intentId = assertReleasableReleaseIntent(snapshot, expectedIntentId)
  if (!intentId) {
    if (expectedIntentId.trim()) {
      throw new Error("manual release dispatch must select a releasable intent")
    }
    return { intentId: "", shouldPublish: false }
  }

  return { intentId, shouldPublish: true }
}

async function main() {
  const snapshotPath =
    process.env.TUCKMARK_RELEASE_SNAPSHOT_PATH ?? "work/release/release-intent.json"
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"))
  const result = classifyReleaseIntent(snapshot, process.env.TUCKMARK_RELEASE_INTENT_ID ?? "")
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_OUTPUT is required")
  }

  await fs.appendFile(
    process.env.GITHUB_OUTPUT,
    `intent_id=${result.intentId}\nshould_publish=${result.shouldPublish}\n`
  )
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
