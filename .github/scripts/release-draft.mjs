#!/usr/bin/env node

import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { releaseIntentPublicationMarker } from "./release-publication-guard.mjs"

export const releaseAssetNames = [
  "SHA256SUMS",
  "tuckmark-host-tools-darwin-arm64.tar.gz",
  "tuckmark-host-tools-darwin-x64.tar.gz",
  "tuckmark-host-tools-linux-x64.tar.gz",
  "tuckmark-host-tools-windows-x64.zip",
]

function assertReleaseAssetsAreExpected(assets) {
  if (!Array.isArray(assets)) {
    throw new Error("release draft assets must be an array")
  }
  const unexpectedAssets = assets
    .map((asset) => asset?.name)
    .filter((name) => !releaseAssetNames.includes(name))
  if (unexpectedAssets.length > 0) {
    throw new Error(`release draft contains unexpected assets: ${unexpectedAssets.join(", ")}`)
  }
}

export function assertRecoverableReleaseDraft({
  release,
  version,
  intentId,
  channelLabel,
  mergeSha,
}) {
  if (!release || typeof release !== "object") {
    throw new Error("release draft must be an object")
  }
  if (release.tagName !== version) {
    throw new Error(`release draft tag must be ${version}`)
  }
  if (release.name !== version) {
    throw new Error(`release draft title must be ${version}`)
  }
  if (release.targetCommitish !== mergeSha) {
    throw new Error(`release draft target must be ${mergeSha}`)
  }
  if (release.isDraft !== true) {
    throw new Error(`release ${version} already exists and is not a recoverable draft`)
  }
  if (release.isPrerelease !== (channelLabel === "channel:preview")) {
    throw new Error(`release draft ${version} does not match ${channelLabel}`)
  }
  if (
    typeof release.body !== "string" ||
    !release.body.includes(releaseIntentPublicationMarker(intentId))
  ) {
    throw new Error(`release draft ${version} is not bound to ${intentId}`)
  }
  assertReleaseAssetsAreExpected(release.assets)

  return release
}

export function assertCompleteReleaseDraft(draft) {
  const release = assertRecoverableReleaseDraft(draft)
  const assetNames = release.assets.map((asset) => asset.name).sort()
  const expectedAssetNames = [...releaseAssetNames].sort()
  if (JSON.stringify(assetNames) !== JSON.stringify(expectedAssetNames)) {
    throw new Error("release draft does not contain the complete expected asset set")
  }

  return release
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

async function main() {
  const mode = process.argv[2] ?? "recover"
  const draftPath = process.env.TUCKMARK_RELEASE_DRAFT_PATH ?? "work/release/release-draft.json"
  const release = JSON.parse(await fs.readFile(draftPath, "utf8"))
  const draft = {
    release,
    version: requireEnvironment("TUCKMARK_RELEASE_VERSION"),
    intentId: requireEnvironment("TUCKMARK_RELEASE_INTENT_ID"),
    channelLabel: requireEnvironment("TUCKMARK_RELEASE_CHANNEL_LABEL"),
    mergeSha: requireEnvironment("TUCKMARK_RELEASE_MERGE_SHA"),
  }
  const result =
    mode === "recover"
      ? assertRecoverableReleaseDraft(draft)
      : mode === "verify-assets"
        ? assertCompleteReleaseDraft(draft)
        : (() => {
            throw new Error(`unknown release draft mode: ${mode}`)
          })()
  console.log(JSON.stringify({ tag_name: result.tagName, mode }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
