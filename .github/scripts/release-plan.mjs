#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) {
    return null
  }

  return match.slice(1).map(Number)
}

export function parseReleaseTrainVersion(value) {
  const stableVersion = parseVersion(value)
  if (stableVersion) {
    return stableVersion
  }

  const previewMatch = /^v?(\d+)\.(\d+)\.(\d+)-preview\.(\d+)$/.exec(value)
  if (!previewMatch) {
    return null
  }

  return previewMatch.slice(1, 4).map(Number)
}

export function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }

  return 0
}

export function formatVersion(version) {
  return `v${version.join(".")}`
}

export function bumpVersion(currentVersion, typeLabel) {
  const [major, minor, patch] = currentVersion

  if (typeLabel === "type:major") {
    return [major + 1, 0, 0]
  }
  if (typeLabel === "type:minor") {
    return [major, minor + 1, 0]
  }
  if (typeLabel === "type:patch") {
    return [major, minor, patch + 1]
  }

  return [major, minor, patch]
}

function readGitTags() {
  return execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" })
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
}

function readLatestStableVersion(tagNames, packageVersion) {
  const stableTags = tagNames
    .map((tag) => ({ tag, version: parseVersion(tag) }))
    .filter((entry) => entry.version !== null)
    .filter((entry) => /^v\d+\.\d+\.\d+$/.test(entry.tag))
    .sort((left, right) => compareVersion(left.version, right.version))

  return stableTags.at(-1)?.version ?? parseVersion(String(packageVersion)) ?? [0, 1, 0]
}

function readCurrentTrainVersion(tagNames, fallbackVersion) {
  const releaseTrainVersions = tagNames
    .map((tag) => parseReleaseTrainVersion(tag))
    .filter((version) => version !== null)
    .sort(compareVersion)

  return releaseTrainVersions.at(-1) ?? fallbackVersion
}

function readNextPreviewNumber(tagNames, stableVersion) {
  const previewTags = tagNames
    .map((tag) => {
      const match = new RegExp(`^${stableVersion.replaceAll(".", "\\.")}-preview\\.(\\d+)$`).exec(
        tag
      )
      return match ? Number(match[1]) : null
    })
    .filter((value) => value !== null)
    .map(Number)
    .sort((left, right) => left - right)

  return (previewTags.at(-1) ?? 0) + 1
}

export function buildReleasePlan(snapshot, tagNames, packageVersion) {
  const latestStableVersion = readLatestStableVersion(tagNames, packageVersion)
  const requestedVersion = bumpVersion(latestStableVersion, snapshot.type_label)
  const currentTrainVersion = readCurrentTrainVersion(tagNames, latestStableVersion)
  const nextTrainVersion =
    compareVersion(requestedVersion, currentTrainVersion) > 0
      ? requestedVersion
      : currentTrainVersion
  const stableVersion = formatVersion(nextTrainVersion)
  const previewNumber = readNextPreviewNumber(tagNames, stableVersion)
  const previewVersion = `${stableVersion}-preview.${previewNumber}`
  const releaseVersion =
    snapshot.channel_label === "channel:preview" ? previewVersion : stableVersion

  return {
    ...snapshot,
    requested_version: formatVersion(requestedVersion),
    current_train_version: formatVersion(currentTrainVersion),
    stable_version: stableVersion,
    release_version: releaseVersion,
  }
}

async function main() {
  const snapshotPath = process.argv[2] ?? "work/release/release-intent.json"
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"))
  const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"))
  const plan = buildReleasePlan(snapshot, readGitTags(), packageJson.version)

  await fs.mkdir("work/release", { recursive: true })
  await fs.writeFile("work/release/release-plan.json", JSON.stringify(plan, null, 2))
  console.log(JSON.stringify(plan, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
