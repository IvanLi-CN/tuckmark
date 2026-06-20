#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"

const snapshotPath = process.argv[2] ?? "work/release/release-intent.json"
const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"))
const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"))

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) {
    return null
  }

  return match.slice(1).map(Number)
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }

  return 0
}

function readGitTags() {
  return execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
}

const stableTags = readGitTags()
  .map((tag) => ({ tag, version: parseVersion(tag) }))
  .filter((entry) => entry.version !== null)
  .filter((entry) => /^v\d+\.\d+\.\d+$/.test(entry.tag))
  .sort((left, right) => compareVersion(left.version, right.version))

const currentVersion = stableTags.at(-1)?.version ??
  parseVersion(String(packageJson.version)) ?? [0, 1, 0]

const [major, minor, patch] = currentVersion

let nextMajor = major
let nextMinor = minor
let nextPatch = patch

if (snapshot.type_label === "type:major") {
  nextMajor += 1
  nextMinor = 0
  nextPatch = 0
} else if (snapshot.type_label === "type:minor") {
  nextMinor += 1
  nextPatch = 0
} else if (snapshot.type_label === "type:patch") {
  nextPatch += 1
}

const stableVersion = `v${nextMajor}.${nextMinor}.${nextPatch}`
const previewTags = readGitTags()
  .map((tag) => {
    const match = new RegExp(`^${stableVersion.replaceAll(".", "\\.")}-preview\\.(\\d+)$`).exec(tag)
    return match ? Number(match[1]) : null
  })
  .filter((value) => value !== null)
  .map(Number)
const previewNumber = (previewTags.at(-1) ?? 0) + 1
const previewVersion = `${stableVersion}-preview.${previewNumber}`
const releaseVersion = snapshot.channel_label === "channel:preview" ? previewVersion : stableVersion

const plan = {
  ...snapshot,
  stable_version: stableVersion,
  release_version: releaseVersion,
}

await fs.mkdir("work/release", { recursive: true })
await fs.writeFile("work/release/release-plan.json", JSON.stringify(plan, null, 2))
console.log(JSON.stringify(plan, null, 2))
