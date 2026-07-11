import { expect, test } from "@playwright/test"

function numberValue(value: string): number {
  return Number.parseFloat(value)
}

test("dragging a Transformer corner resizes the selected rectangle without translating its fixed edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/canvas?demo=true")

  await page.getByRole("button", { name: "图层 1 矩形" }).click()

  const xInput = page.getByRole("spinbutton", { name: "X" })
  const yInput = page.getByRole("spinbutton", { name: "Y" })
  const widthInput = page.getByRole("spinbutton", { name: "宽" })
  const heightInput = page.getByRole("spinbutton", { name: "高" })
  await expect(xInput).toHaveValue("2.5")
  await expect(widthInput).toHaveValue("43.0")

  const before = {
    x: numberValue(await xInput.inputValue()),
    y: numberValue(await yInput.inputValue()),
    width: numberValue(await widthInput.inputValue()),
    height: numberValue(await heightInput.inputValue()),
  }
  const paper = await page.locator(".tm-stage-paper--base").evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      x: bounds.x,
      y: bounds.y,
      scale: bounds.width / 384,
    }
  })
  const topLeftHandle = {
    x: paper.x + 20 * paper.scale,
    y: paper.y + 18 * paper.scale,
  }

  await page.mouse.move(topLeftHandle.x, topLeftHandle.y)
  await page.mouse.down()
  await page.mouse.move(topLeftHandle.x - 26, topLeftHandle.y - 26)
  await page.mouse.up()

  await expect
    .poll(async () => numberValue(await widthInput.inputValue()))
    .toBeGreaterThan(before.width)
  await expect
    .poll(async () => numberValue(await heightInput.inputValue()))
    .toBeGreaterThan(before.height)

  const after = {
    x: numberValue(await xInput.inputValue()),
    y: numberValue(await yInput.inputValue()),
    width: numberValue(await widthInput.inputValue()),
    height: numberValue(await heightInput.inputValue()),
  }
  expect(Math.abs(after.x + after.width - (before.x + before.width))).toBeLessThanOrEqual(0.15)
  expect(Math.abs(after.y + after.height - (before.y + before.height))).toBeLessThanOrEqual(0.15)
})

test("dragging a Transformer corner still resizes after pointer-centered canvas zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/canvas?demo=true")

  const stage = page.locator(".konvajs-content")
  const stageBounds = await stage.boundingBox()
  expect(stageBounds).not.toBeNull()
  await page.mouse.move(
    (stageBounds?.x ?? 0) + (stageBounds?.width ?? 0) / 2,
    (stageBounds?.y ?? 0) + (stageBounds?.height ?? 0) / 2
  )
  await page.mouse.wheel(0, -120)

  await page.getByRole("button", { name: "图层 1 矩形" }).click()
  const xInput = page.getByRole("spinbutton", { name: "X" })
  const yInput = page.getByRole("spinbutton", { name: "Y" })
  const widthInput = page.getByRole("spinbutton", { name: "宽" })
  const heightInput = page.getByRole("spinbutton", { name: "高" })
  const before = {
    x: numberValue(await xInput.inputValue()),
    y: numberValue(await yInput.inputValue()),
    width: numberValue(await widthInput.inputValue()),
    height: numberValue(await heightInput.inputValue()),
  }
  const paper = await page.locator(".tm-stage-paper--base").evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      x: bounds.x,
      y: bounds.y,
      scale: bounds.width / 384,
    }
  })
  const topLeftHandle = {
    x: paper.x + 20 * paper.scale,
    y: paper.y + 18 * paper.scale,
  }

  await page.mouse.move(topLeftHandle.x, topLeftHandle.y)
  await page.mouse.down()
  await page.mouse.move(topLeftHandle.x - 26, topLeftHandle.y - 26)
  await page.mouse.up()

  await expect
    .poll(async () => numberValue(await widthInput.inputValue()))
    .toBeGreaterThan(before.width)
  await expect
    .poll(async () => numberValue(await heightInput.inputValue()))
    .toBeGreaterThan(before.height)
  const after = {
    x: numberValue(await xInput.inputValue()),
    y: numberValue(await yInput.inputValue()),
    width: numberValue(await widthInput.inputValue()),
    height: numberValue(await heightInput.inputValue()),
  }
  expect(Math.abs(after.x + after.width - (before.x + before.width))).toBeLessThanOrEqual(0.15)
  expect(Math.abs(after.y + after.height - (before.y + before.height))).toBeLessThanOrEqual(0.15)
})

test("dragging a Transformer side handle changes only its active dimension", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/canvas?demo=true")
  await page.getByRole("button", { name: "图层 1 矩形" }).click()

  const xInput = page.getByRole("spinbutton", { name: "X" })
  const yInput = page.getByRole("spinbutton", { name: "Y" })
  const widthInput = page.getByRole("spinbutton", { name: "宽" })
  const heightInput = page.getByRole("spinbutton", { name: "高" })
  const before = {
    x: numberValue(await xInput.inputValue()),
    y: numberValue(await yInput.inputValue()),
    width: numberValue(await widthInput.inputValue()),
    height: numberValue(await heightInput.inputValue()),
  }
  const paper = await page.locator(".tm-stage-paper--base").evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      x: bounds.x,
      y: bounds.y,
      scale: bounds.width / 384,
    }
  })
  const middleRightHandle = {
    x: paper.x + 364 * paper.scale,
    y: paper.y + 110 * paper.scale,
  }

  await page.mouse.move(middleRightHandle.x, middleRightHandle.y)
  await page.mouse.down()
  await page.mouse.move(middleRightHandle.x + 26, middleRightHandle.y)
  await page.mouse.up()

  await expect
    .poll(async () => numberValue(await widthInput.inputValue()))
    .toBeGreaterThan(before.width)
  const after = {
    x: numberValue(await xInput.inputValue()),
    y: numberValue(await yInput.inputValue()),
    width: numberValue(await widthInput.inputValue()),
    height: numberValue(await heightInput.inputValue()),
  }
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.15)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.15)
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(0.15)
})
