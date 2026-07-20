import { expect, test } from "@playwright/test"

const STORYBOOK_STORIES = [
  {
    id: "tuckmark-workbench--home-navigation-hold",
    label: "home navigation hold",
  },
  {
    id: "tuckmark-workbench--templates-navigation-pending",
    label: "templates navigation pending",
  },
] as const

test.describe("navigation transition layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test("renders the progress bar as a viewport-wide top overlay", async ({ page }) => {
    for (const story of STORYBOOK_STORIES) {
      await page.goto(`/iframe.html?viewMode=story&id=${story.id}`)
      await expect(page.locator(".tm-shell")).toBeVisible()

      const metrics = await page.evaluate(() => {
        const progress = document.querySelector<HTMLElement>(".tm-nav-progress")
        const bar = document.querySelector<HTMLElement>(".tm-nav-progress__bar")
        if (!progress || !bar) {
          return null
        }
        const rect = progress.getBoundingClientRect()
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewportWidth: window.innerWidth,
          position: window.getComputedStyle(progress).position,
          barRadius: window.getComputedStyle(bar).borderTopLeftRadius,
        }
      })

      expect(metrics).not.toBeNull()
      expect(metrics?.position).toBe("fixed")
      expect(metrics?.top).toBe(0)
      expect(metrics?.left).toBe(0)
      expect(Math.abs((metrics?.width ?? 0) - (metrics?.viewportWidth ?? 0))).toBeLessThanOrEqual(1)
      expect(metrics?.height ?? 0).toBeGreaterThan(0)
      expect(metrics?.barRadius).toBe("0px")
    }
  })

  test("does not shift the shell layout when the progress bar appears", async ({ page }) => {
    const measureShellAnchors = async (storyId: string) => {
      await page.goto(`/iframe.html?viewMode=story&id=${storyId}`)
      await expect(page.locator(".tm-shell")).toBeVisible()

      return page.evaluate(() => {
        const header = document.querySelector<HTMLElement>(".tm-header")
        const main = document.querySelector<HTMLElement>(".tm-main")
        if (!header || !main) {
          return null
        }
        const headerRect = header.getBoundingClientRect()
        const mainRect = main.getBoundingClientRect()
        return {
          headerTop: Math.round(headerRect.top),
          mainTop: Math.round(mainRect.top),
        }
      })
    }

    const homeIdle = await measureShellAnchors("tuckmark-workbench--home")
    const homeHolding = await measureShellAnchors("tuckmark-workbench--home-navigation-hold")
    const templatesLoaded = await measureShellAnchors(
      "tuckmark-workbench--templates-navigation-loaded"
    )
    const templatesPending = await measureShellAnchors(
      "tuckmark-workbench--templates-navigation-pending"
    )

    expect(homeIdle).not.toBeNull()
    expect(homeHolding).not.toBeNull()
    expect(templatesLoaded).not.toBeNull()
    expect(templatesPending).not.toBeNull()

    expect(homeHolding?.headerTop).toBe(homeIdle?.headerTop)
    expect(homeHolding?.mainTop).toBe(homeIdle?.mainTop)
    expect(templatesPending?.headerTop).toBe(templatesLoaded?.headerTop)
    expect(templatesPending?.mainTop).toBe(templatesLoaded?.mainTop)
  })

  for (const story of STORYBOOK_STORIES) {
    test(`keeps the shell chrome compact during ${story.label}`, async ({ page }) => {
      await page.goto(`/iframe.html?viewMode=story&id=${story.id}`)
      await expect(page.locator(".tm-shell")).toBeVisible()

      const metrics = await page.evaluate(() => {
        const measure = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (!element) {
            return null
          }
          const rect = element.getBoundingClientRect()
          return {
            height: Math.round(rect.height),
            top: Math.round(rect.top),
          }
        }

        return {
          header: measure(".tm-header"),
          main: measure(".tm-main"),
          footer: measure(".tm-footer"),
          routeLoading: measure(".tm-route-loading"),
        }
      })

      expect(metrics.header).not.toBeNull()
      expect(metrics.main).not.toBeNull()
      expect(metrics.footer).not.toBeNull()

      expect(metrics.header?.height ?? 0).toBeLessThan(200)
      expect(metrics.main?.height ?? 0).toBeGreaterThan(250)

      if (story.id === "tuckmark-workbench--templates-navigation-pending") {
        expect(metrics.routeLoading).not.toBeNull()
        expect(metrics.routeLoading?.height ?? 0).toBeGreaterThan(250)
      }
    })
  }
})
