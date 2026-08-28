#!/usr/bin/env node

import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { promoteSkippedReleaseSnapshot, releaseIntentArtifactName } from "./release-intent.mjs"

function requireEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

async function githubJson(pathname) {
  const token = requireEnvironment("GITHUB_TOKEN")
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API ${pathname} failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

async function fetchPullRequest(prNumber) {
  const [owner, repo] = requireEnvironment("GITHUB_REPOSITORY").split("/")
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be formatted as owner/repo")
  }

  return githubJson(`/repos/${owner}/${repo}/pulls/${prNumber}`)
}

async function fetchActionsRun(runId) {
  const [owner, repo] = requireEnvironment("GITHUB_REPOSITORY").split("/")
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be formatted as owner/repo")
  }

  return githubJson(`/repos/${owner}/${repo}/actions/runs/${runId}`)
}

export async function promoteReleaseIntent({
  sourceSnapshotPath = process.env.TUCKMARK_SOURCE_SNAPSHOT_PATH ??
    "work/release/source/release-intent.json",
} = {}) {
  const sourceSnapshot = JSON.parse(await fs.readFile(sourceSnapshotPath, "utf8"))
  const requestedPrNumber = requireEnvironment("TUCKMARK_PROMOTION_PR_NUMBER")
  const sourceRunId = requireEnvironment("TUCKMARK_SOURCE_RUN_ID")
  const pullRequest = await fetchPullRequest(requestedPrNumber)
  const sourceRun = await fetchActionsRun(sourceRunId)
  const releaseIntent = promoteSkippedReleaseSnapshot({
    sourceSnapshot,
    sourceRunId,
    sourceArtifactName: requireEnvironment("TUCKMARK_SOURCE_ARTIFACT_NAME"),
    requestedPrNumber,
    requestedMergeSha: requireEnvironment("TUCKMARK_PROMOTION_MERGE_SHA"),
    typeLabel: requireEnvironment("TUCKMARK_PROMOTION_TYPE_LABEL"),
    channelLabel: requireEnvironment("TUCKMARK_PROMOTION_CHANNEL_LABEL"),
    actor: requireEnvironment("GITHUB_ACTOR"),
    reason: requireEnvironment("TUCKMARK_PROMOTION_REASON"),
    pullRequest,
    sourceRun,
  })

  await fs.mkdir("work/release", { recursive: true })
  await fs.writeFile(
    "work/release/release-intent.json",
    `${JSON.stringify(releaseIntent, null, 2)}\n`
  )

  const artifactName = releaseIntentArtifactName(releaseIntent.intent_id)
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `intent_id=${releaseIntent.intent_id}\nartifact_name=${artifactName}\n`
    )
  }

  return { artifact_name: artifactName, release_intent: releaseIntent }
}

async function main() {
  const result = await promoteReleaseIntent()
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
