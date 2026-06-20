#!/usr/bin/env node

import fs from "node:fs/promises"

const policy = JSON.parse(
  await fs.readFile(new URL("../pr-label-release.json", import.meta.url), "utf8")
)

const raw = process.env.PR_LABELS_JSON ?? "[]"
const labels = JSON.parse(raw)
const names = labels
  .map((label) => (typeof label === "string" ? label : label.name))
  .filter(Boolean)

const typeLabels = names.filter((name) => policy.type_labels.includes(name))
const channelLabels = names.filter((name) => policy.channel_labels.includes(name))
const releaseLabels = new Set([...policy.type_labels, ...policy.channel_labels])
const unknownReleaseLabels = names
  .filter((name) => name.startsWith("type:") || name.startsWith("channel:"))
  .filter((name) => !releaseLabels.has(name))

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (unknownReleaseLabels.length > 0) {
  fail(`Unknown release labels: ${unknownReleaseLabels.join(", ")}`)
}

if (typeLabels.length !== 1) {
  fail(`Expected exactly one type:* label, got ${typeLabels.length}`)
}

if (typeLabels[0] === "type:none") {
  if (channelLabels.length > 0) {
    fail("type:none cannot be combined with channel:* labels")
  }
  console.log("release intent: none")
  process.exit(0)
}

if (channelLabels.length !== 1) {
  fail(`Expected exactly one channel:* label for releasable PR, got ${channelLabels.length}`)
}

console.log(`release intent: ${typeLabels[0]} + ${channelLabels[0]}`)
