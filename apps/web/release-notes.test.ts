import { describe, expect, it } from "vitest"

import {
  assertReleaseNotesContract,
  buildReleaseContext,
  buildReleaseNotesModel,
  renderReleaseNotes,
} from "../../.github/scripts/release-notes.mjs"

describe("release notes contract", () => {
  it("renders stable release notes from a verified release plan and pull request", () => {
    const releaseContext = buildReleaseContext({
      release_version: "v0.5.2",
      pr_number: 44,
      type_label: "type:patch",
      channel_label: "channel:stable",
      merge_sha: "7c61a5faf50462245602ad3a63858597676f7cc0",
      artifacts: ["runtime bundle", "CLI bundle"],
    })
    const notesModel = buildReleaseNotesModel(releaseContext, {
      number: 44,
      title: "fix(web): retry browser-direct wasm init after transient failure",
      html_url: "https://github.com/IvanLi-CN/tuckmark/pull/44",
      merge_commit_sha: "7c61a5faf50462245602ad3a63858597676f7cc0",
    })

    const notes = renderReleaseNotes(releaseContext, notesModel)

    expect(notes).toContain("Stable type:patch release for `v0.5.2`")
    expect(notes).toContain("## Included Change")
    expect(notes).toContain("[#44](https://github.com/IvanLi-CN/tuckmark/pull/44)")
    expect(notes).toContain("## Release Metadata")
    expect(notes).toContain("`channel:stable`")
    expect(notes).toContain("`7c61a5faf50462245602ad3a63858597676f7cc0`")
    expect(notes).toContain("## Bundles")
    expect(notes).toContain("- runtime bundle")
    expect(notes).toContain("- CLI bundle")
    expect(notes).not.toContain("Tuckmark release v0.5.2")
    expect(() => assertReleaseNotesContract(notes)).not.toThrow()
  })

  it("renders preview release notes without changing the required sections", () => {
    const releaseContext = buildReleaseContext({
      release_version: "v0.6.0-preview.1",
      pr_number: 45,
      type_label: "type:minor",
      channel_label: "channel:preview",
      merge_sha: "1111111111111111111111111111111111111111",
      artifacts: ["runtime bundle", "CLI bundle"],
    })
    const notesModel = buildReleaseNotesModel(releaseContext, {
      number: 45,
      title: "feat(web): add preview-only runtime probes",
      html_url: "https://github.com/IvanLi-CN/tuckmark/pull/45",
      merge_commit_sha: "1111111111111111111111111111111111111111",
    })

    const notes = renderReleaseNotes(releaseContext, notesModel)

    expect(notes).toContain("Preview type:minor release for `v0.6.0-preview.1`")
    expect(notes).toContain("`channel:preview`")
    expect(() => assertReleaseNotesContract(notes)).not.toThrow()
  })

  it("fails fast when releasable context is missing the pull request number", () => {
    expect(() =>
      buildReleaseContext({
        release_version: "v0.5.2",
        type_label: "type:patch",
        channel_label: "channel:stable",
        merge_sha: "7c61a5faf50462245602ad3a63858597676f7cc0",
        artifacts: ["runtime bundle", "CLI bundle"],
      })
    ).toThrow("pr_number must be a positive integer")
  })

  it("fails fast when the pull request metadata does not match the release context", () => {
    const releaseContext = buildReleaseContext({
      release_version: "v0.5.2",
      pr_number: 44,
      type_label: "type:patch",
      channel_label: "channel:stable",
      merge_sha: "7c61a5faf50462245602ad3a63858597676f7cc0",
      artifacts: ["runtime bundle", "CLI bundle"],
    })

    expect(() =>
      buildReleaseNotesModel(releaseContext, {
        number: 43,
        title: "fix(web): stabilize PWA startup shell transitions",
        html_url: "https://github.com/IvanLi-CN/tuckmark/pull/43",
        merge_commit_sha: "2fa0cbab5a4d92993a3bab8597bb4ca4e0442de1",
      })
    ).toThrow("does not match pr_number")
  })
})
