import { describe, expect, it } from "vitest"

import {
  buildOctoRillReleaseUrl,
  hasBuildMetadataMismatch,
  normalizeBuildRef,
  normalizeRuntimeBuildMetadata,
  normalizeVersionTag,
  resolveFooterVersionMetadata,
  resolveGitHubRepositoryCoordinates,
} from "./version-metadata.js"

describe("version metadata helpers", () => {
  it("normalizes tagged versions without duplicating the visible prefix", () => {
    expect(normalizeVersionTag("v0.2.0-preview.11")).toBe("0.2.0-preview.11")
    expect(normalizeVersionTag("0.2.0-preview.11")).toBe("0.2.0-preview.11")
  })

  it("shortens git hashes while keeping custom build references intact", () => {
    expect(normalizeBuildRef("E4994267326EB940DCA6878193B0C514E69A7F0E")).toBe("e499426")
    expect(normalizeBuildRef("build-local")).toBe("build-local")
  })

  it("normalizes runtime build metadata as a reusable comparison shape", () => {
    expect(
      normalizeRuntimeBuildMetadata({
        appVersion: "v0.2.0-preview.11",
        buildRef: "E4994267326EB940DCA6878193B0C514E69A7F0E",
      })
    ).toEqual({
      appVersion: "0.2.0-preview.11",
      buildRef: "e499426",
    })
  })

  it("treats either build or version divergence as a deploy mismatch", () => {
    expect(
      hasBuildMetadataMismatch(
        { appVersion: "0.2.0-preview.11", buildRef: "e499426" },
        { appVersion: "0.2.0-preview.11", buildRef: "f7a7393" }
      )
    ).toBe(true)
    expect(
      hasBuildMetadataMismatch(
        { appVersion: "", buildRef: "e499426" },
        { appVersion: "0.2.0-preview.11", buildRef: "e499426" }
      )
    ).toBe(true)
    expect(
      hasBuildMetadataMismatch(
        { appVersion: "v0.2.0-preview.11", buildRef: "E4994267326EB940DCA6878193B0C514E69A7F0E" },
        { appVersion: "0.2.0-preview.11", buildRef: "e499426" }
      )
    ).toBe(false)
  })

  it("renders tagged builds as a visible version with build reference tooltip metadata", () => {
    expect(
      resolveFooterVersionMetadata({
        appVersion: "0.2.0-preview.11",
        buildRef: "e4994267326eb940dca6878193b0c514e69a7f0e",
        repositoryUrl: "https://github.com/IvanLi-CN/tuckmark",
      })
    ).toEqual({
      visibleLabel: "v0.2.0-preview.11",
      tooltipLabel: "build e499426",
      ariaLabel: "v0.2.0-preview.11, build e499426",
      linkHref:
        "https://octo-rill.ivanli.cc/IvanLi-CN/tuckmark/releases?highlight=tag%3Av0.2.0-preview.11&highlight_active=tag%3Av0.2.0-preview.11",
    })
  })

  it("renders untagged builds as build reference only", () => {
    expect(resolveFooterVersionMetadata({ appVersion: "", buildRef: "e499426" })).toEqual({
      visibleLabel: "build e499426",
      tooltipLabel: null,
      ariaLabel: "build e499426",
      linkHref: null,
    })
  })

  it("keeps local fallback builds on the package version when no build ref exists", () => {
    expect(resolveFooterVersionMetadata({ appVersion: "0.1.0", buildRef: "" })).toEqual({
      visibleLabel: "v0.1.0",
      tooltipLabel: null,
      ariaLabel: "v0.1.0",
      linkHref: null,
    })
  })

  it("keeps tagged builds unlinked when the repository URL cannot be mapped to GitHub", () => {
    expect(
      resolveFooterVersionMetadata({
        appVersion: "0.2.0-preview.11",
        buildRef: "e499426",
        repositoryUrl: "https://example.test/not-github",
      })
    ).toEqual({
      visibleLabel: "v0.2.0-preview.11",
      tooltipLabel: "build e499426",
      ariaLabel: "v0.2.0-preview.11, build e499426",
      linkHref: null,
    })
  })

  it("parses standard GitHub repository URLs with trailing slash or .git suffix", () => {
    expect(resolveGitHubRepositoryCoordinates("https://github.com/IvanLi-CN/tuckmark/")).toEqual({
      owner: "IvanLi-CN",
      repo: "tuckmark",
    })
    expect(resolveGitHubRepositoryCoordinates("https://github.com/IvanLi-CN/tuckmark.git")).toEqual(
      {
        owner: "IvanLi-CN",
        repo: "tuckmark",
      }
    )
  })

  it("rejects non-standard repository URLs when building OctoRill release links", () => {
    expect(
      buildOctoRillReleaseUrl({
        repositoryUrl: "git@github.com:IvanLi-CN/tuckmark.git",
        tag: "0.2.0",
      })
    ).toBeNull()
    expect(
      buildOctoRillReleaseUrl({ repositoryUrl: "https://github.com/IvanLi-CN", tag: "0.2.0" })
    ).toBeNull()
  })

  it("URL-encodes the highlighted release tag for OctoRill deep links", () => {
    expect(
      buildOctoRillReleaseUrl({
        repositoryUrl: "https://github.com/IvanLi-CN/tuckmark",
        tag: "v1.2.3-preview/rc 1",
      })
    ).toBe(
      "https://octo-rill.ivanli.cc/IvanLi-CN/tuckmark/releases?highlight=tag%3Av1.2.3-preview%2Frc+1&highlight_active=tag%3Av1.2.3-preview%2Frc+1"
    )
  })
})
