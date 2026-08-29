import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"
import {
  assertCompleteReleaseDraft,
  assertRecoverableReleaseDraft,
  releaseAssetNames,
} from "../../.github/scripts/release-draft.mjs"
import {
  assertPromotionSourceRun,
  createReleaseIntentId,
  promoteSkippedReleaseSnapshot,
  releaseIntentArtifactName,
} from "../../.github/scripts/release-intent.mjs"
import { buildReleasePlan } from "../../.github/scripts/release-plan.mjs"
import {
  assertReleaseIntentNotPublished,
  releaseIntentPublicationMarker,
} from "../../.github/scripts/release-publication-guard.mjs"
import {
  findReleaseTagReservation,
  releaseIntentTagMarker,
} from "../../.github/scripts/release-tag-reservation.mjs"
import {
  assertManualReleaseSourceRun,
  selectManualSnapshotArtifact,
} from "../../.github/scripts/select-release-snapshot.mjs"

const mergeSha = "35e3945db2b75260f30b33ec2a8ef04fc67e9ade"
const sourceRunId = "33186783254"
const sourceArtifactName = `release-intent-host-tools-skipped-${mergeSha}`

function skippedSnapshot() {
  return {
    version: 2,
    merge_sha: mergeSha,
    pr_number: 88,
    merged_at: "2026-08-28T15:46:27Z",
    type_label: "type:none",
    channel_label: null,
    release_pending: false,
    state: "skipped",
    artifacts: ["four platform host-tools archives", "SHA256SUMS"],
  }
}

function mergedPullRequest() {
  return {
    number: 88,
    state: "closed",
    merged_at: "2026-08-28T15:46:27Z",
    merge_commit_sha: mergeSha,
    base: { ref: "main" },
    head: {
      ref: "th/fix-template-datamatrix-metadata",
      sha: "ea6956091a072a498efe2dc115d6463e2828c6b0",
    },
  }
}

function sourceRun() {
  return {
    path: ".github/workflows/ci-main.yml",
    event: "pull_request",
    conclusion: "success",
    head_branch: "th/fix-template-datamatrix-metadata",
    head_sha: "ea6956091a072a498efe2dc115d6463e2828c6b0",
  }
}

function promote(overrides = {}) {
  return promoteSkippedReleaseSnapshot({
    sourceSnapshot: skippedSnapshot(),
    sourceRunId,
    sourceArtifactName,
    requestedPrNumber: 88,
    requestedMergeSha: mergeSha,
    typeLabel: "type:patch",
    channelLabel: "channel:preview",
    actor: "IvanLi-CN",
    reason: "Recover the skipped release intent after merge.",
    pullRequest: mergedPullRequest(),
    sourceRun: sourceRun(),
    ...overrides,
  })
}

describe("release-intent promotion", () => {
  it("promotes the #88 skipped snapshot to the next preview patch without mutating its source", () => {
    const sourceSnapshot = skippedSnapshot()
    const originalSource = structuredClone(sourceSnapshot)
    const intent = promote({ sourceSnapshot })
    const plan = buildReleasePlan(
      intent,
      ["v0.11.1", "v0.12.0-preview.5", "v0.12.0-preview.6"],
      "0.1.0"
    )

    expect(intent).toMatchObject({
      intent_id: `pr-88-${mergeSha}-patch-preview`,
      merge_sha: mergeSha,
      pr_number: 88,
      type_label: "type:patch",
      channel_label: "channel:preview",
      promoted_from: {
        source_run_id: sourceRunId,
        source_artifact_name: sourceArtifactName,
        source_workflow_path: ".github/workflows/ci-main.yml",
      },
      promotion: {
        actor: "IvanLi-CN",
        reason: "Recover the skipped release intent after merge.",
      },
    })
    expect(plan.release_version).toBe("v0.12.0-preview.7")
    expect(sourceSnapshot).toEqual(originalSource)
  })

  it("rejects mismatched PR, SHA, source artifact, and illegal promotion labels", () => {
    expect(() => promote({ requestedPrNumber: 87 })).toThrow("requested pr_number")
    expect(() =>
      promote({ requestedMergeSha: "1111111111111111111111111111111111111111" })
    ).toThrow("requested merge_sha")
    expect(() =>
      promote({ sourceArtifactName: "release-intent-host-tools-skipped-wrong" })
    ).toThrow("source_artifact_name")
    expect(() => promote({ typeLabel: "type:none", channelLabel: null })).toThrow("releasable type")
    expect(() => promote({ channelLabel: null })).toThrow("channel_label")
  })

  it("rejects source runs from another workflow, a failed ci-main run, and a mismatched PR head", () => {
    expect(() =>
      assertPromotionSourceRun(
        { ...sourceRun(), path: ".github/workflows/other.yml" },
        mergedPullRequest()
      )
    ).toThrow("ci-main.yml")
    expect(() =>
      assertPromotionSourceRun({ ...sourceRun(), conclusion: "failure" }, mergedPullRequest())
    ).toThrow("successful")
    expect(() =>
      assertPromotionSourceRun({ ...sourceRun(), head_sha: mergeSha }, mergedPullRequest())
    ).toThrow("head SHA")
  })

  it("reuses an intent-bound release tag after a failed publication attempt", () => {
    const intent = promote()
    const reservation = {
      tag_name: "v0.12.0-preview.7",
      target_sha: mergeSha,
      message: `release reservation\n${releaseIntentTagMarker(intent.intent_id)}`,
    }
    const found = findReleaseTagReservation({
      reservations: [reservation],
      intentId: intent.intent_id,
      mergeSha,
    })
    const plan = buildReleasePlan(
      intent,
      ["v0.11.1", "v0.12.0-preview.5", "v0.12.0-preview.6", reservation.tag_name],
      "0.1.0",
      { reservedReleaseVersion: found.tag_name }
    )

    expect(plan.release_version).toBe(reservation.tag_name)
  })

  it("rejects an unbound or wrong-SHA release tag", () => {
    const intent = promote()
    expect(() =>
      findReleaseTagReservation({
        reservations: [{ tag_name: "v0.12.0-preview.7", target_sha: mergeSha, message: "other" }],
        intentId: intent.intent_id,
        mergeSha,
        tagName: "v0.12.0-preview.7",
      })
    ).toThrow("not reserved")
    expect(() =>
      findReleaseTagReservation({
        reservations: [
          {
            tag_name: "v0.12.0-preview.7",
            target_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            message: releaseIntentTagMarker(intent.intent_id),
          },
        ],
        intentId: intent.intent_id,
        mergeSha,
      })
    ).toThrow("does not target")
  })

  it("discovers and verifies an annotated tag reservation from Git", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "tuckmark-release-tag-"))
    const snapshotPath = join(fixtureDirectory, "release-intent.json")
    const outputPath = join(fixtureDirectory, "github-output")
    const scriptPath = fileURLToPath(
      new URL("../../.github/scripts/release-tag-reservation.mjs", import.meta.url)
    )

    try {
      const runGit = (args) =>
        execFileSync("git", args, { cwd: fixtureDirectory, encoding: "utf8" }).trim()
      runGit(["init", "--quiet"])
      runGit(["config", "user.name", "Tuckmark Test"])
      runGit(["config", "user.email", "test@example.com"])
      await writeFile(join(fixtureDirectory, "fixture"), "release tag fixture\n")
      runGit(["add", "fixture"])
      runGit(["commit", "--quiet", "-m", "fixture"])
      const fixtureSha = runGit(["rev-parse", "HEAD"])
      const intentId = createReleaseIntentId({
        prNumber: 1,
        mergeSha: fixtureSha,
        typeLabel: "type:patch",
        channelLabel: "channel:preview",
      })
      const tagName = "v0.12.0-preview.7"
      await writeFile(
        snapshotPath,
        `${JSON.stringify({
          version: 3,
          intent_id: intentId,
          merge_sha: fixtureSha,
          pr_number: 1,
          merged_at: "2026-08-28T15:46:27Z",
          type_label: "type:patch",
          channel_label: "channel:preview",
          release_pending: true,
          state: "next-pending",
          artifacts: [],
        })}\n`
      )
      runGit([
        "tag",
        "--annotate",
        tagName,
        fixtureSha,
        "--message",
        releaseIntentTagMarker(intentId),
      ])

      execFileSync(process.execPath, [scriptPath, "discover"], {
        cwd: fixtureDirectory,
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputPath,
          TUCKMARK_RELEASE_SNAPSHOT_PATH: snapshotPath,
        },
      })
      expect(await readFile(outputPath, "utf8")).toBe(`release_version=${tagName}\n`)

      execFileSync(process.execPath, [scriptPath, "verify"], {
        cwd: fixtureDirectory,
        env: {
          ...process.env,
          TUCKMARK_RELEASE_INTENT_ID: intentId,
          TUCKMARK_RELEASE_MERGE_SHA: fixtureSha,
          TUCKMARK_RELEASE_VERSION: tagName,
        },
      })
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true })
    }
  })

  it("resumes only the exact draft that belongs to the release intent", () => {
    const intent = promote()
    const release = {
      tagName: "v0.12.0-preview.7",
      name: "v0.12.0-preview.7",
      isDraft: true,
      isPrerelease: true,
      targetCommitish: mergeSha,
      body: `Release metadata\n${releaseIntentPublicationMarker(intent.intent_id)}`,
      assets: [],
    }

    expect(
      assertRecoverableReleaseDraft({
        release,
        version: release.tagName,
        intentId: intent.intent_id,
        channelLabel: "channel:preview",
        mergeSha,
      })
    ).toEqual(release)
    expect(() =>
      assertRecoverableReleaseDraft({
        release: { ...release, isDraft: false },
        version: release.tagName,
        intentId: intent.intent_id,
        channelLabel: "channel:preview",
        mergeSha,
      })
    ).toThrow("not a recoverable draft")
    expect(() =>
      assertRecoverableReleaseDraft({
        release: { ...release, body: "other release" },
        version: release.tagName,
        intentId: intent.intent_id,
        channelLabel: "channel:preview",
        mergeSha,
      })
    ).toThrow("not bound")
    expect(() =>
      assertRecoverableReleaseDraft({
        release: { ...release, targetCommitish: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        version: release.tagName,
        intentId: intent.intent_id,
        channelLabel: "channel:preview",
        mergeSha,
      })
    ).toThrow("target")
    expect(() =>
      assertRecoverableReleaseDraft({
        release: { ...release, assets: [{ name: "unexpected.txt" }] },
        version: release.tagName,
        intentId: intent.intent_id,
        channelLabel: "channel:preview",
        mergeSha,
      })
    ).toThrow("unexpected assets")
    expect(() =>
      assertCompleteReleaseDraft({
        release,
        version: release.tagName,
        intentId: intent.intent_id,
        channelLabel: "channel:preview",
        mergeSha,
      })
    ).toThrow("complete expected asset set")
    const completeRelease = { ...release, assets: releaseAssetNames.map((name) => ({ name })) }
    expect(
      assertCompleteReleaseDraft({
        release: completeRelease,
        version: release.tagName,
        intentId: intent.intent_id,
        channelLabel: "channel:preview",
        mergeSha,
      })
    ).toEqual(completeRelease)
  })
})

describe("manual release selection", () => {
  it("accepts only the exact run, artifact, and intent target", () => {
    const intent = promote()
    const artifactName = releaseIntentArtifactName(intent.intent_id)
    const artifact = { id: 99, expired: false, name: artifactName }

    expect(
      selectManualSnapshotArtifact({
        runId: "33190000000",
        artifactName,
        intentId: intent.intent_id,
        artifacts: [
          { id: 1, expired: false, name: "release-intent-host-tools-next-pending-cc9f005" },
          artifact,
        ],
      })
    ).toEqual(artifact)
    expect(() =>
      selectManualSnapshotArtifact({
        runId: "33190000000",
        artifactName,
        intentId: intent.intent_id,
        artifacts: [
          { id: 1, expired: false, name: "release-intent-host-tools-next-pending-cc9f005" },
        ],
      })
    ).toThrow("exact release-intent snapshot artifact was not found")
    expect(() =>
      selectManualSnapshotArtifact({
        runId: "",
        artifactName,
        intentId: intent.intent_id,
        artifacts: [artifact],
      })
    ).toThrow("source_run_id")
    expect(() =>
      assertManualReleaseSourceRun({ path: ".github/workflows/other.yml", conclusion: "success" })
    ).toThrow("must produce")
    expect(() =>
      assertManualReleaseSourceRun({
        path: ".github/workflows/release-intent-promotion.yml",
        conclusion: "failure",
      })
    ).toThrow("must have succeeded")
  })
})

describe("release-intent replay protection", () => {
  it("rejects an intent already recorded in a published release", () => {
    const intent = promote()
    const releases = [
      {
        draft: false,
        tag_name: "v0.12.0-preview.7",
        html_url: "https://github.com/IvanLi-CN/tuckmark/releases/tag/v0.12.0-preview.7",
        body: `Release metadata\n${releaseIntentPublicationMarker(intent.intent_id)}`,
      },
    ]

    expect(() => assertReleaseIntentNotPublished(releases, intent.intent_id)).toThrow(
      "was already published"
    )
  })
})
