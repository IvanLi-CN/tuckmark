import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  createPwaHtmlTags,
  createPwaManifest,
  createServiceWorkerSource,
  hashPwaString,
  resolveApiOrigin,
  resolveAppVersion,
  resolveBuildRef,
  resolvePublicBase,
  resolveRepositoryUrl,
  resolveRightsUrl,
} from "./vite.config.js"

describe("resolveApiOrigin", () => {
  it("prefers explicit api origin", () => {
    expect(
      resolveApiOrigin({
        TUCKMARK_API_ORIGIN: "http://127.0.0.1:5171",
        TUCKMARK_SERVER_PORT: "5210",
      })
    ).toBe("http://127.0.0.1:5171")
  })

  it("falls back to the configured server port", () => {
    expect(
      resolveApiOrigin({
        TUCKMARK_SERVER_PORT: "5171",
      })
    ).toBe("http://127.0.0.1:5171")
  })

  it("uses the default server port when nothing is configured", () => {
    expect(resolveApiOrigin({})).toBe("http://127.0.0.1:5210")
  })
})

describe("resolvePublicBase", () => {
  it("keeps the dev server on an absolute root base even for browser-static surface", () => {
    expect(resolvePublicBase({ TUCKMARK_WEB_SURFACE: "browser-static" }, "serve")).toBe("/")
  })

  it("uses a relative base only for browser-static builds", () => {
    expect(resolvePublicBase({ TUCKMARK_WEB_SURFACE: "browser-static" }, "build")).toBe("./")
  })

  it("keeps server-http builds on the root base", () => {
    expect(resolvePublicBase({ TUCKMARK_WEB_SURFACE: "server-http" }, "build")).toBe("/")
  })
})

describe("PWA build assets", () => {
  it("defines browser-static-only head tags for install metadata", () => {
    expect(createPwaHtmlTags()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: "link",
          attrs: expect.objectContaining({ rel: "manifest", href: "./manifest.webmanifest" }),
        }),
        expect.objectContaining({
          tag: "link",
          attrs: expect.objectContaining({ rel: "icon", href: "./pwa/tuckmark-icon-192.png" }),
        }),
      ])
    )
  })

  it("uses relative manifest and icon URLs for browser-static Pages builds", () => {
    expect(createPwaManifest()).toMatchObject({
      start_url: "./",
      scope: "./",
      display: "standalone",
      icons: [
        {
          src: "./pwa/tuckmark-icon-192.png",
          purpose: "any maskable",
        },
        {
          src: "./pwa/tuckmark-icon-512.png",
          purpose: "any maskable",
        },
      ],
    })
  })

  it("generates a service worker with app-shell caching and update activation", () => {
    const source = createServiceWorkerSource({
      version: "test-version",
      assets: [
        { url: "./index.html", revision: "index" },
        { url: "./assets/app.js", revision: "app" },
        { url: "./pwa/tuckmark-icon-192.png", revision: "icon" },
      ],
    })

    expect(source).toContain("tuckmark-app-")
    expect(source).toContain('"./index.html"')
    expect(source).toContain('"./assets/app.js"')
    expect(source).toContain('"./pwa/tuckmark-icon-192.png"')
    expect(source).toContain('event.data?.type === "SKIP_WAITING"')
    expect(source).toContain('request.mode === "navigate"')
  })

  it("changes service worker output when same-url bundle content changes", () => {
    const first = createServiceWorkerSource({
      version: hashPwaString("./assets/app.js:first-content"),
      assets: [{ url: "./assets/app.js", revision: hashPwaString("first-content") }],
    })
    const second = createServiceWorkerSource({
      version: hashPwaString("./assets/app.js:second-content"),
      assets: [{ url: "./assets/app.js", revision: hashPwaString("second-content") }],
    })

    expect(first).not.toBe(second)
  })
})

describe("footer metadata", () => {
  it("uses package and repository defaults", () => {
    expect(resolveAppVersion({})).toBe("0.1.0")
    expect(resolveBuildRef({})).toBe("")
    expect(resolveRepositoryUrl({})).toBe("https://github.com/IvanLi-CN/tuckmark")
    expect(resolveRightsUrl({})).toBe("https://ivanli.cc/")
  })

  it("allows builds to override metadata", () => {
    const env = {
      TUCKMARK_APP_VERSION: "1.2.3-preview.4",
      TUCKMARK_BUILD_REF: "e4994267326eb940dca6878193b0c514e69a7f0e",
      TUCKMARK_REPOSITORY_URL: "https://example.test/repo/",
      TUCKMARK_RIGHTS_URL: "https://example.test/rights/",
    }

    expect(resolveAppVersion(env)).toBe("1.2.3-preview.4")
    expect(resolveBuildRef(env)).toBe("e499426")
    expect(resolveRepositoryUrl(env)).toBe("https://example.test/repo/")
    expect(resolveRightsUrl(env)).toBe("https://example.test/rights/")
  })

  it("uses the GitHub tag name for release-triggered Pages builds", () => {
    expect(
      resolveAppVersion({
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v0.2.0-preview.5",
      })
    ).toBe("0.2.0-preview.5")
  })

  it("uses build-only metadata for untagged owner-facing builds", () => {
    expect(
      resolveAppVersion({
        GITHUB_SHA: "e4994267326eb940dca6878193b0c514e69a7f0e",
      })
    ).toBe("")
    expect(
      resolveBuildRef({
        GITHUB_SHA: "e4994267326eb940dca6878193b0c514e69a7f0e",
      })
    ).toBe("e499426")
  })
})

describe("Pages workflow metadata", () => {
  const pagesWorkflow = readFileSync(
    new URL("../../.github/workflows/pages.yml", import.meta.url),
    "utf8"
  )

  it("redeploys Pages when a GitHub Release is published", () => {
    expect(pagesWorkflow).toContain("release:\n    types: [published]")
  })

  it("checks out the published release tag for release-triggered Pages builds", () => {
    expect(pagesWorkflow).toContain("github.event.release.tag_name")
  })

  it("accepts an explicit release tag for release workflow dispatches", () => {
    expect(pagesWorkflow).toContain("release_tag:")
    expect(pagesWorkflow).toContain("inputs.release_tag")
    expect(pagesWorkflow).toContain("TUCKMARK_APP_VERSION=")
    expect(pagesWorkflow).toContain("TUCKMARK_BUILD_REF=")
    expect(pagesWorkflow).toContain("git rev-parse --short HEAD")
  })
})

describe("Release workflow Pages redeploy", () => {
  const releaseWorkflow = readFileSync(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8"
  )

  it("dispatches Pages after publishing a GitHub Release", () => {
    expect(releaseWorkflow).toContain("actions: write")
    expect(releaseWorkflow).toContain("gh workflow run pages.yml --ref main -f release_tag")
  })
})
