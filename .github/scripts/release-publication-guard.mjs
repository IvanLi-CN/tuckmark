#!/usr/bin/env node

import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { assertReleasableReleaseIntent } from "./release-intent.mjs"

export function releaseIntentPublicationMarker(intentId) {
  return `<!-- tuckmark-release-intent:${intentId} -->`
}

export function findPublishedReleaseForIntent(releases, intentId) {
  const marker = releaseIntentPublicationMarker(intentId)
  return releases.find(
    (release) =>
      release?.draft !== true && typeof release?.body === "string" && release.body.includes(marker)
  )
}

export function assertReleaseIntentNotPublished(releases, intentId) {
  const publishedRelease = findPublishedReleaseForIntent(releases, intentId)
  if (publishedRelease) {
    throw new Error(
      `release intent ${intentId} was already published by ${publishedRelease.html_url ?? publishedRelease.tag_name}`
    )
  }
}

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

export async function listPublishedReleases(repository) {
  const [owner, repo] = repository.split("/")
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be formatted as owner/repo")
  }

  const releases = []
  for (let page = 1; ; page += 1) {
    const pageReleases = await githubJson(
      `/repos/${owner}/${repo}/releases?per_page=100&page=${page}`
    )
    if (!Array.isArray(pageReleases)) {
      throw new Error("GitHub releases response must be an array")
    }

    releases.push(...pageReleases)
    if (pageReleases.length < 100) {
      return releases
    }
  }
}

export async function guardReleaseIntentPublication({
  planPath = "work/release/release-plan.json",
  repository = process.env.GITHUB_REPOSITORY ?? "",
} = {}) {
  const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
  const intentId = assertReleasableReleaseIntent(plan)
  if (!intentId) {
    return { skipped: true }
  }

  const releases = await listPublishedReleases(repository)
  assertReleaseIntentNotPublished(releases, intentId)
  return { skipped: false, intent_id: intentId }
}

async function main() {
  const result = await guardReleaseIntentPublication()
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
