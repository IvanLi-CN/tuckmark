#!/usr/bin/env node

import fs from "node:fs/promises"

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const repository = process.env.GITHUB_REPOSITORY

if (!token) {
  throw new Error("GITHUB_TOKEN is required")
}

if (!repository) {
  throw new Error("GITHUB_REPOSITORY is required")
}

const [owner, repo] = repository.split("/")
const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
const eventName = process.env.GITHUB_EVENT_NAME ?? ""

async function githubJson(pathname) {
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

async function findSnapshotArtifact(runId, prefix) {
  const payload = await githubJson(
    `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`
  )

  const artifact = (payload.artifacts ?? []).find(
    (item) => !item.expired && item.name.startsWith(prefix)
  )

  return artifact ?? null
}

let runId = ""
let artifactName = ""

if (eventName === "workflow_dispatch") {
  const runsPayload = await githubJson(
    `/repos/${owner}/${repo}/actions/workflows/ci-main.yml/runs?status=completed&per_page=50`
  )

  for (const run of runsPayload.workflow_runs ?? []) {
    if (run.conclusion !== "success") {
      continue
    }

    const artifact = await findSnapshotArtifact(run.id, "release-intent-next-pending-")
    if (!artifact) {
      continue
    }

    runId = String(run.id)
    artifactName = artifact.name
    break
  }
} else {
  runId = String(event.workflow_run?.id ?? "")
  if (runId) {
    const artifact = await findSnapshotArtifact(runId, "release-intent-")
    artifactName = artifact?.name ?? ""
  }
}

if (!runId || !artifactName) {
  throw new Error("No release-intent snapshot artifact found")
}

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `run_id=${runId}\nartifact_name=${artifactName}\n`)
}

console.log(JSON.stringify({ run_id: runId, artifact_name: artifactName }, null, 2))
