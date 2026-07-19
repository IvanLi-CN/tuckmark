#!/usr/bin/env node

import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`)
  }

  return value.trim()
}

function requirePositiveInteger(value, fieldName) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`)
  }

  return parsed
}

function requireStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty array`)
  }

  return value.map((entry, index) => requireString(entry, `${fieldName}[${index}]`))
}

export function buildReleaseContext(plan) {
  return {
    release_version: requireString(plan.release_version, "release_version"),
    pr_number: requirePositiveInteger(plan.pr_number, "pr_number"),
    type_label: requireString(plan.type_label, "type_label"),
    channel_label: requireString(plan.channel_label, "channel_label"),
    merge_sha: requireString(plan.merge_sha, "merge_sha"),
    artifacts: requireStringArray(plan.artifacts, "artifacts"),
  }
}

export function buildReleaseNotesModel(releaseContext, pullRequest) {
  const prNumber = requirePositiveInteger(pullRequest.number, "pull_request.number")
  if (prNumber !== releaseContext.pr_number) {
    throw new Error(
      `pull_request.number ${prNumber} does not match pr_number ${releaseContext.pr_number}`
    )
  }

  const mergeCommitSha =
    typeof pullRequest.merge_commit_sha === "string" ? pullRequest.merge_commit_sha.trim() : ""
  if (mergeCommitSha && mergeCommitSha !== releaseContext.merge_sha) {
    throw new Error(
      `pull_request.merge_commit_sha ${mergeCommitSha} does not match merge_sha ${releaseContext.merge_sha}`
    )
  }

  return {
    release_class: releaseContext.channel_label === "channel:preview" ? "preview" : "stable",
    pr_title: requireString(pullRequest.title, "pull_request.title"),
    pr_url: requireString(pullRequest.html_url, "pull_request.html_url"),
  }
}

export function renderReleaseNotes(releaseContext, notesModel) {
  const releaseClassLabel = notesModel.release_class === "preview" ? "Preview" : "Stable"
  const pullRequestLink = `[#${releaseContext.pr_number}](${notesModel.pr_url})`

  return [
    `${releaseClassLabel} ${releaseContext.type_label} release for \`${releaseContext.release_version}\`: ${notesModel.pr_title}`,
    "",
    "## Included Change",
    `- ${pullRequestLink} ${notesModel.pr_title}`,
    "",
    "## Release Metadata",
    `- Version: \`${releaseContext.release_version}\``,
    `- Channel: \`${releaseContext.channel_label}\``,
    `- Release type: \`${releaseContext.type_label}\``,
    `- Merge commit: \`${releaseContext.merge_sha}\``,
    `- Pull request: ${pullRequestLink}`,
    "",
    "## Bundles",
    ...releaseContext.artifacts.map((artifact) => `- ${artifact}`),
  ].join("\n")
}

export function assertReleaseNotesContract(notes) {
  const requiredSections = ["## Included Change", "## Release Metadata", "## Bundles"]
  for (const section of requiredSections) {
    if (!notes.includes(section)) {
      throw new Error(`release notes missing required section: ${section}`)
    }
  }
}

async function githubJson(pathname) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (!token) {
    throw new Error("GITHUB_TOKEN is required")
  }

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

async function fetchPullRequest(repository, prNumber) {
  const [owner, repo] = requireString(repository, "repository").split("/")
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be formatted as owner/repo")
  }

  return githubJson(`/repos/${owner}/${repo}/pulls/${prNumber}`)
}

export async function writeReleaseNotesArtifacts({
  planPath = "work/release/release-plan.json",
  outputDir = "work/release",
  repository = process.env.GITHUB_REPOSITORY ?? "",
} = {}) {
  const releasePlan = JSON.parse(await fs.readFile(planPath, "utf8"))
  if (releasePlan.type_label === "type:none") {
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, "skipped=true\n")
    }

    return { skipped: true }
  }

  const releaseContext = buildReleaseContext(releasePlan)
  const pullRequest = await fetchPullRequest(repository, releaseContext.pr_number)
  const notesModel = buildReleaseNotesModel(releaseContext, pullRequest)
  const notes = renderReleaseNotes(releaseContext, notesModel)
  assertReleaseNotesContract(notes)

  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(
    `${outputDir}/release-context.json`,
    `${JSON.stringify(releaseContext, null, 2)}\n`
  )
  await fs.writeFile(`${outputDir}/release-notes.md`, `${notes}\n`)

  const artifactName = `release-context-${releaseContext.merge_sha}`
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `artifact_name=${artifactName}\nskipped=false\n`)
  }

  return {
    skipped: false,
    artifact_name: artifactName,
    release_context: releaseContext,
    notes,
  }
}

async function main() {
  const result = await writeReleaseNotesArtifacts()
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
