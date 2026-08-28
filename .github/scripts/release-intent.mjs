const releaseTypeLabels = new Set(["type:major", "type:minor", "type:patch"])
const releaseChannelLabels = new Set(["channel:stable", "channel:preview"])

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

function requireMergeSha(value, fieldName) {
  const mergeSha = requireString(value, fieldName)
  if (!/^[0-9a-f]{40}$/i.test(mergeSha)) {
    throw new Error(`${fieldName} must be a 40-character Git SHA`)
  }

  return mergeSha
}

function requireRunId(value, fieldName) {
  const runId = requireString(value, fieldName)
  if (!/^\d+$/.test(runId)) {
    throw new Error(`${fieldName} must be a GitHub Actions run id`)
  }

  return runId
}

export function assertReleaseLabels({ typeLabel, channelLabel }, fieldPrefix = "release intent") {
  if (typeLabel === "type:none") {
    if (channelLabel !== null && channelLabel !== undefined) {
      throw new Error(`${fieldPrefix} type:none must not include a channel label`)
    }

    return
  }

  if (!releaseTypeLabels.has(typeLabel)) {
    throw new Error(`${fieldPrefix} type_label must be a legal releasing type`)
  }

  if (!releaseChannelLabels.has(channelLabel)) {
    throw new Error(`${fieldPrefix} channel_label must be channel:stable or channel:preview`)
  }
}

export function createReleaseIntentId({ prNumber, mergeSha, typeLabel, channelLabel }) {
  const normalizedPrNumber = requirePositiveInteger(prNumber, "pr_number")
  const normalizedMergeSha = requireMergeSha(mergeSha, "merge_sha")
  assertReleaseLabels({ typeLabel, channelLabel }, "release intent")

  if (typeLabel === "type:none") {
    throw new Error("release intent id requires a releasable type")
  }

  return `pr-${normalizedPrNumber}-${normalizedMergeSha}-${typeLabel.slice(5)}-${channelLabel.slice(8)}`
}

export function createMergedReleaseSnapshot({ pullRequest, labels }) {
  const mergeSha = requireMergeSha(pullRequest?.merge_commit_sha, "pull_request.merge_commit_sha")
  const prNumber = requirePositiveInteger(pullRequest?.number, "pull_request.number")
  const mergedAt = requireString(pullRequest?.merged_at, "pull_request.merged_at")
  const typeLabel = labels.find((label) => label.startsWith("type:")) ?? "type:none"
  const channelLabel = labels.find((label) => label.startsWith("channel:")) ?? null

  assertReleaseLabels({ typeLabel, channelLabel }, "merge-time labels")

  const releasePending = typeLabel !== "type:none"
  const snapshot = {
    version: 3,
    merge_sha: mergeSha,
    pr_number: prNumber,
    merged_at: mergedAt,
    type_label: typeLabel,
    channel_label: channelLabel,
    release_pending: releasePending,
    state: releasePending ? "next-pending" : "skipped",
    artifacts: ["four platform host-tools archives", "SHA256SUMS"],
  }

  if (releasePending) {
    snapshot.intent_id = createReleaseIntentId({
      prNumber,
      mergeSha,
      typeLabel,
      channelLabel,
    })
  }

  return snapshot
}

function assertSkippedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("source snapshot must be an object")
  }

  if (snapshot.state !== "skipped" || snapshot.release_pending !== false) {
    throw new Error("source snapshot must be an immutable skipped intent")
  }

  assertReleaseLabels(
    { typeLabel: snapshot.type_label, channelLabel: snapshot.channel_label },
    "source snapshot"
  )
  if (snapshot.type_label !== "type:none") {
    throw new Error("source snapshot must have type:none")
  }
}

function assertMergedPullRequest(pullRequest, prNumber, mergeSha) {
  if (pullRequest?.state !== "closed" || !pullRequest?.merged_at) {
    throw new Error("pull request must be merged")
  }
  if (pullRequest.number !== prNumber) {
    throw new Error("pull request does not match source snapshot pr_number")
  }
  if (pullRequest.merge_commit_sha !== mergeSha) {
    throw new Error("pull request does not match source snapshot merge_sha")
  }
  if (pullRequest.base?.ref !== "main") {
    throw new Error("pull request must target main")
  }
}

export function assertPromotionSourceRun(sourceRun, pullRequest) {
  if (sourceRun?.path !== ".github/workflows/ci-main.yml") {
    throw new Error("source run must use .github/workflows/ci-main.yml")
  }
  if (sourceRun.event !== "pull_request" || sourceRun.conclusion !== "success") {
    throw new Error("source run must be a successful pull_request ci-main run")
  }
  if (sourceRun.head_branch !== pullRequest.head?.ref) {
    throw new Error("source run head branch does not match the merged pull request")
  }
  if (sourceRun.head_sha !== pullRequest.head?.sha) {
    throw new Error("source run head SHA does not match the merged pull request")
  }
}

export function promoteSkippedReleaseSnapshot({
  sourceSnapshot,
  sourceRunId,
  sourceArtifactName,
  requestedPrNumber,
  requestedMergeSha,
  typeLabel,
  channelLabel,
  actor,
  reason,
  pullRequest,
  sourceRun,
}) {
  assertSkippedSnapshot(sourceSnapshot)
  const prNumber = requirePositiveInteger(sourceSnapshot.pr_number, "source snapshot pr_number")
  const mergeSha = requireMergeSha(sourceSnapshot.merge_sha, "source snapshot merge_sha")
  const sourceMergedAt = requireString(sourceSnapshot.merged_at, "source snapshot merged_at")
  const normalizedRunId = requireRunId(sourceRunId, "source_run_id")
  const normalizedArtifactName = requireString(sourceArtifactName, "source_artifact_name")
  const expectedArtifactName = `release-intent-host-tools-skipped-${mergeSha}`
  if (normalizedArtifactName !== expectedArtifactName) {
    throw new Error(`source_artifact_name must be ${expectedArtifactName}`)
  }
  if (requirePositiveInteger(requestedPrNumber, "pr_number") !== prNumber) {
    throw new Error("requested pr_number does not match source snapshot")
  }
  if (requireMergeSha(requestedMergeSha, "merge_sha") !== mergeSha) {
    throw new Error("requested merge_sha does not match source snapshot")
  }

  assertReleaseLabels({ typeLabel, channelLabel }, "promotion request")
  if (typeLabel === "type:none") {
    throw new Error("promotion request must use a releasable type")
  }

  assertMergedPullRequest(pullRequest, prNumber, mergeSha)
  assertPromotionSourceRun(sourceRun, pullRequest)

  return {
    version: 3,
    intent_id: createReleaseIntentId({ prNumber, mergeSha, typeLabel, channelLabel }),
    merge_sha: mergeSha,
    pr_number: prNumber,
    merged_at: sourceMergedAt,
    type_label: typeLabel,
    channel_label: channelLabel,
    release_pending: true,
    state: "next-pending",
    artifacts: [...sourceSnapshot.artifacts],
    promoted_from: {
      source_run_id: normalizedRunId,
      source_artifact_name: normalizedArtifactName,
      source_merge_sha: mergeSha,
      source_pr_number: prNumber,
      source_snapshot_state: sourceSnapshot.state,
      source_workflow_path: sourceRun.path,
      source_head_branch: sourceRun.head_branch,
      source_head_sha: sourceRun.head_sha,
    },
    promotion: {
      actor: requireString(actor, "actor"),
      reason: requireString(reason, "reason"),
    },
  }
}

export function assertReleasableReleaseIntent(snapshot, expectedIntentId = "") {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("release snapshot must be an object")
  }

  assertReleaseLabels(
    { typeLabel: snapshot.type_label, channelLabel: snapshot.channel_label },
    "release snapshot"
  )
  if (snapshot.type_label === "type:none") {
    return null
  }

  const intentId = requireString(snapshot.intent_id, "release snapshot intent_id")
  const expected = createReleaseIntentId({
    prNumber: snapshot.pr_number,
    mergeSha: snapshot.merge_sha,
    typeLabel: snapshot.type_label,
    channelLabel: snapshot.channel_label,
  })
  if (intentId !== expected) {
    throw new Error("release snapshot intent_id does not match its release identity")
  }
  if (expectedIntentId && intentId !== expectedIntentId) {
    throw new Error("release snapshot intent_id does not match manual dispatch input")
  }

  return intentId
}

export function releaseIntentArtifactName(intentId) {
  return `release-intent-host-tools-next-pending-${requireString(intentId, "intent_id")}`
}
