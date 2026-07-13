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

test("canvas wheel input zooms around the pointer without a modifier key", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/canvas?demo=true")

  const stage = page.locator(".konvajs-content")
  await stage.hover({ position: { x: 220, y: 180 } })
  const before = await getPaperBounds(page)

  await page.mouse.wheel(0, -96)

  await expect.poll(async () => (await getPaperBounds(page)).width).toBeGreaterThan(before.width)
})

test("Space + drag pans from label content without changing zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/canvas?demo=true")

  const before = await getPaperBounds(page)
  const start = {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  }

  await page.mouse.move(start.x, start.y)
  await page.keyboard.down(" ")
  await page.mouse.down()
  await page.mouse.move(start.x - 96, start.y - 72)
  await page.mouse.up()
  await page.keyboard.up(" ")

  await expect.poll(async () => (await getPaperBounds(page)).x).toBeLessThan(before.x - 80)
  const after = await getPaperBounds(page)
  expect(after.y).toBeLessThan(before.y - 60)
  expect(after.width).toBeCloseTo(before.width, 1)
  expect(after.height).toBeCloseTo(before.height, 1)
})
