#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { assertReleasableReleaseIntent } from "./release-intent.mjs"

export function releaseIntentTagMarker(intentId) {
  return `tuckmark-release-intent:${intentId}`
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

function readTagReservation(tagName) {
  if (runGit(["cat-file", "-t", tagName]) !== "tag") {
    return null
  }

  const tagObject = runGit(["cat-file", "tag", tagName])
  const [header, message = ""] = tagObject.split("\n\n", 2)
  const objectMatch = /^object ([0-9a-f]{40})$/m.exec(header)
  if (!objectMatch) {
    throw new Error(`annotated tag ${tagName} is missing its target object`)
  }

  return {
    tag_name: tagName,
    target_sha: runGit(["rev-parse", `${tagName}^{commit}`]),
    message,
  }
}

export function findReleaseTagReservation({ reservations, intentId, mergeSha, tagName = null }) {
  const marker = releaseIntentTagMarker(intentId)
  const matchingReservations = reservations.filter((reservation) =>
    reservation.message.includes(marker)
  )

  if (matchingReservations.length > 1) {
    throw new Error(`multiple release tag reservations exist for ${intentId}`)
  }

  const reservation = matchingReservations[0] ?? null
  if (!reservation) {
    if (tagName) {
      throw new Error(`release tag ${tagName} is not reserved for ${intentId}`)
    }
    return null
  }
  if (tagName && reservation.tag_name !== tagName) {
    throw new Error(
      `release tag ${tagName} does not match the reserved tag ${reservation.tag_name}`
    )
  }
  if (reservation.target_sha !== mergeSha) {
    throw new Error(`reserved release tag ${reservation.tag_name} does not target ${mergeSha}`)
  }

  return reservation
}

export function readReleaseTagReservations(tagNames) {
  return tagNames.map(readTagReservation).filter(Boolean)
}

async function main() {
  const mode = process.argv[2] ?? "discover"
  const suppliedIntentId = process.env.TUCKMARK_RELEASE_INTENT_ID?.trim() ?? ""
  const suppliedMergeSha = process.env.TUCKMARK_RELEASE_MERGE_SHA?.trim() ?? ""
  let intentId = suppliedIntentId
  let mergeSha = suppliedMergeSha
  if (!intentId || !mergeSha) {
    const snapshotPath =
      process.env.TUCKMARK_RELEASE_SNAPSHOT_PATH ?? "work/release/release-intent.json"
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"))
    intentId = assertReleasableReleaseIntent(snapshot)
    mergeSha = snapshot.merge_sha
  }
  if (!intentId || !mergeSha) {
    throw new Error("release tag reservation requires a releasable intent and merge SHA")
  }
  const reservations = readReleaseTagReservations(
    runGit(["tag", "--list", "v*"]).split("\n").filter(Boolean)
  )
  const tagName = process.env.TUCKMARK_RELEASE_VERSION?.trim() || null
  const reservation = findReleaseTagReservation({
    reservations,
    intentId,
    mergeSha,
    tagName,
  })

  if (mode === "discover") {
    if (reservation && process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `release_version=${reservation.tag_name}\n`)
    }
    console.log(JSON.stringify({ reservation }, null, 2))
    return
  }
  if (mode === "verify") {
    if (!tagName) {
      throw new Error("TUCKMARK_RELEASE_VERSION is required for tag verification")
    }
    console.log(JSON.stringify({ reservation }, null, 2))
    return
  }

  throw new Error(`unknown release tag reservation mode: ${mode}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
