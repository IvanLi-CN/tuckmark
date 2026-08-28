#!/usr/bin/env node

import fs from "node:fs/promises"

import { createMergedReleaseSnapshot } from "./release-intent.mjs"

const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"))
const pullRequest = event.pull_request
if (!pullRequest?.merged) {
  throw new Error("release snapshots require a merged pull_request event")
}

const labels = (pullRequest.labels ?? []).map((label) => label.name)
const releaseIntent = createMergedReleaseSnapshot({ pullRequest, labels })
const mergeSha = releaseIntent.merge_sha

const artifactName = `release-intent-host-tools-${releaseIntent.state}-${mergeSha}`

await fs.mkdir("work/release", { recursive: true })
await fs.writeFile("work/release/release-intent.json", JSON.stringify(releaseIntent, null, 2))
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(
    process.env.GITHUB_OUTPUT,
    `artifact_name=${artifactName}\nstate=${releaseIntent.state}\nmerge_sha=${mergeSha}\n`
  )
}
console.log(JSON.stringify(releaseIntent, null, 2))
