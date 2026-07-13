import { expect, type Page, test } from "@playwright/test"

type PaperBounds = {
  x: number
  y: number
  width: number
  height: number
}

async function getPaperBounds(page: Page): Promise<PaperBounds> {
  return page.locator(".tm-stage-paper--base").evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }
  })
}

test("unmodified canvas wheel input pans on both axes without changing the zoom level", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/canvas?demo=true")

  const stage = page.locator(".konvajs-content")
  await stage.hover({ position: { x: 220, y: 180 } })

  const beforeHorizontal = await getPaperBounds(page)
  await page.mouse.wheel(96, 0)

  await expect
    .poll(async () => getPaperBounds(page))
    .toMatchObject({
      width: beforeHorizontal.width,
      height: beforeHorizontal.height,
    })
  const afterHorizontal = await getPaperBounds(page)
  expect(afterHorizontal.x).toBeLessThan(beforeHorizontal.x - 80)
  expect(afterHorizontal.y).toBeCloseTo(beforeHorizontal.y, 1)

  const beforeVertical = afterHorizontal
  await page.mouse.wheel(0, 96)

  await expect
    .poll(async () => getPaperBounds(page))
    .toMatchObject({
      width: beforeVertical.width,
      height: beforeVertical.height,
    })
  const afterVertical = await getPaperBounds(page)
  expect(afterVertical.x).toBeCloseTo(beforeVertical.x, 1)
  expect(afterVertical.y).toBeLessThan(beforeVertical.y - 80)
})

test("modified canvas wheel input zooms without panning the stage", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/canvas?demo=true")

  const stage = page.locator(".konvajs-content")
  await stage.hover({ position: { x: 220, y: 180 } })
  const before = await getPaperBounds(page)

  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -96)
  await page.keyboard.up("Control")

  await expect.poll(async () => (await getPaperBounds(page)).width).toBeGreaterThan(before.width)
})
