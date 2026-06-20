#!/usr/bin/env node

import fs from "node:fs/promises"

const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
const labels = (event.pull_request?.labels ?? []).map((label) => label.name)
const mergedAt = event.pull_request?.merged_at ?? new Date().toISOString()
const mergeSha = event.pull_request?.merge_commit_sha ?? process.env.GITHUB_SHA
const prNumber = event.pull_request?.number

const typeLabel = labels.find((label) => label.startsWith("type:")) ?? "type:none"
const channelLabel = labels.find((label) => label.startsWith("channel:")) ?? null

const releaseIntent = {
  version: 1,
  merge_sha: mergeSha,
  pr_number: prNumber,
  merged_at: mergedAt,
  type_label: typeLabel,
  channel_label: channelLabel,
  release_pending: typeLabel !== "type:none",
  state: typeLabel === "type:none" ? "skipped" : "next-pending",
  artifacts: ["runtime bundle", "CLI bundle"],
}

await fs.mkdir("work/release", { recursive: true })
await fs.writeFile("work/release/release-intent.json", JSON.stringify(releaseIntent, null, 2))
console.log(JSON.stringify(releaseIntent, null, 2))
