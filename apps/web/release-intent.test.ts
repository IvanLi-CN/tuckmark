import { describe, expect, it } from "vitest"

import {
  assertPromotionSourceRun,
  promoteSkippedReleaseSnapshot,
  releaseIntentArtifactName,
} from "../../.github/scripts/release-intent.mjs"
import { buildReleasePlan } from "../../.github/scripts/release-plan.mjs"
import {
  assertReleaseIntentNotPublished,
  releaseIntentPublicationMarker,
} from "../../.github/scripts/release-publication-guard.mjs"
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
