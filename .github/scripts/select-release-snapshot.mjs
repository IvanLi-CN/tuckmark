#!/usr/bin/env node

import fs from "node:fs/promises"

import { releaseIntentArtifactName } from "./release-intent.mjs"

async function githubJson(pathname, token) {
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

async function findSnapshotArtifact({ owner, repo, runId, prefix, token }) {
  const payload = await githubJson(
    `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
    token
  )

  const artifact = (payload.artifacts ?? []).find(
    (item) => !item.expired && item.name.startsWith(prefix)
  )

  return artifact ?? null
}

function requireManualInput(inputs, name) {
  const value = inputs?.[name]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`workflow_dispatch requires ${name}`)
  }

  return value.trim()
}

export function selectManualSnapshotArtifact({ runId, artifactName, intentId, artifacts }) {
  if (!/^\d+$/.test(runId)) {
    throw new Error("source_run_id must be a GitHub Actions run id")
  }
  if (artifactName !== releaseIntentArtifactName(intentId)) {
    throw new Error("source_artifact_name must match the exact intent_id")
  }

  const artifact = (artifacts ?? []).find((item) => !item.expired && item.name === artifactName)
  if (!artifact) {
    throw new Error("exact release-intent snapshot artifact was not found")
  }

  return artifact
}

export function assertManualReleaseSourceRun(sourceRun) {
  if (
    sourceRun?.path !== ".github/workflows/ci-main.yml" &&
    sourceRun?.path !== ".github/workflows/release-intent-promotion.yml"
  ) {
    throw new Error("manual release source run must produce a release intent")
  }
  if (sourceRun.conclusion !== "success") {
    throw new Error("manual release source run must have succeeded")
  }
}

export async function selectReleaseSnapshot({ event, eventName, repository, token }) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required")
  }
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required")
  }

  const [owner, repo] = repository.split("/")
  let runId = ""
  let artifactName = ""
  let intentId = ""

  if (eventName === "workflow_dispatch") {
    runId = requireManualInput(event.inputs, "source_run_id")
    artifactName = requireManualInput(event.inputs, "source_artifact_name")
    intentId = requireManualInput(event.inputs, "intent_id")
    const sourceRun = await githubJson(`/repos/${owner}/${repo}/actions/runs/${runId}`, token)
    assertManualReleaseSourceRun(sourceRun)
    const payload = await githubJson(
      `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
      token
    )
    selectManualSnapshotArtifact({
      runId,
      artifactName,
      intentId,
      artifacts: payload.artifacts,
    })
  } else {
    runId = String(event.workflow_run?.id ?? "")
    if (runId) {
      const artifact = await findSnapshotArtifact({
        owner,
        repo,
        runId,
        prefix: "release-intent-host-tools-",
        token,
      })
      artifactName = artifact?.name ?? ""
    }
  }

  if (!runId || !artifactName) {
    throw new Error("No release-intent snapshot artifact found")
  }

  return { run_id: runId, artifact_name: artifactName, intent_id: intentId }
}

async function main() {
  const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
  const result = await selectReleaseSnapshot({
    event,
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  })

  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `run_id=${result.run_id}\nartifact_name=${result.artifact_name}\nintent_id=${result.intent_id}\n`
    )
  }

  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main()
}
