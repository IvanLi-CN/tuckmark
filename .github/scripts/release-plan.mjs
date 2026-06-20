#!/usr/bin/env node

import fs from "node:fs/promises"

const snapshotPath = process.argv[2] ?? "work/release/release-intent.json"
const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"))
const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"))

const [major, minor, patch] = String(packageJson.version).split(".").map(Number)

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
const previewVersion = `${stableVersion}-preview.1`
const releaseVersion = snapshot.channel_label === "channel:preview" ? previewVersion : stableVersion

const plan = {
  ...snapshot,
  stable_version: stableVersion,
  release_version: releaseVersion,
}

await fs.writeFile("work/release/release-plan.json", JSON.stringify(plan, null, 2))
console.log(JSON.stringify(plan, null, 2))
