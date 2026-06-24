import { expect, test } from "@playwright/test"

test("template table keeps the cell size stable when a cell enters edit mode", async ({ page }) => {
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "列表" }).click()

  const table = page.getByRole("table")
  const firstRow = table.locator("tbody tr").first()
  const addressCellButton = firstRow.getByRole("button", { name: "Moon Street 42 Shanghai" })

  await expect(addressCellButton).toBeVisible()

  const beforeBox = await addressCellButton.boundingBox()
  expect(beforeBox).not.toBeNull()

  await addressCellButton.click()

  const addressInput = firstRow.locator("input").first()
  await expect(addressInput).toBeVisible()

  const afterBox = await addressInput.boundingBox()
  expect(afterBox).not.toBeNull()

  expect(Math.abs((afterBox?.width ?? 0) - (beforeBox?.width ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((afterBox?.height ?? 0) - (beforeBox?.height ?? 0))).toBeLessThanOrEqual(1)
})

test("template table keeps one adaptive width per column", async ({ page }) => {
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "列表" }).click()

  const table = page.getByRole("table")
  const rows = table.locator("tbody tr")
  const firstRecipient = rows.nth(0).getByRole("button", { name: "Koha Cat" })
  const secondRecipient = rows.nth(1).getByRole("button", { name: "Koha Cat" })

  const beforeBox = await firstRecipient.boundingBox()
  expect(beforeBox).not.toBeNull()

  await firstRecipient.click()

  const editor = rows.nth(0).locator("input").first()
  await expect(editor).toBeVisible()
  await editor.fill("Koha Cat Distribution Center")
  await editor.press("Enter")

  const firstAfter = await rows
    .nth(0)
    .getByRole("button", { name: "Koha Cat Distribution Center" })
    .boundingBox()
  const secondAfter = await secondRecipient.boundingBox()

  expect(firstAfter).not.toBeNull()
  expect(secondAfter).not.toBeNull()

  expect(Math.abs((firstAfter?.width ?? 0) - (secondAfter?.width ?? 0))).toBeLessThanOrEqual(1)
  expect((firstAfter?.width ?? 0) - (beforeBox?.width ?? 0)).toBeGreaterThan(20)
})

test("template table stretches its columns to fill the available table width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "列表" }).click()

  const measurements = await page.locator(".tm-table-shell").evaluate((shell) => {
    const table = shell.querySelector("table")
    const firstRow = table?.querySelector("tbody tr")
    if (!table || !firstRow) {
      return null
    }

    const cells = Array.from(firstRow.querySelectorAll("td"))
    const innerFits = cells.slice(1).map((cell) => {
      const inner = cell.querySelector("button, input")
      const style = getComputedStyle(cell)
      const contentWidth =
        cell.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight)
      return {
        contentWidth: Math.round(contentWidth),
        innerWidth: inner ? Math.round(inner.getBoundingClientRect().width) : 0,
      }
    })

    return {
      shellWidth: Math.round(shell.clientWidth),
      rowWidth: Math.round(firstRow.getBoundingClientRect().width),
      innerFits,
    }
  })

  expect(measurements).not.toBeNull()
  expect(
    Math.abs((measurements?.rowWidth ?? 0) - (measurements?.shellWidth ?? 0))
  ).toBeLessThanOrEqual(2)
  for (const fit of measurements?.innerFits ?? []) {
    expect(Math.abs(fit.innerWidth - fit.contentWidth)).toBeLessThanOrEqual(1)
  }
})

test("template table keeps horizontal scrolling when the allocated pane becomes narrower than its columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "列表" }).click()

  const overflow = await page.locator(".tm-table-shell").evaluate((shell) => ({
    clientWidth: shell.clientWidth,
    scrollWidth: shell.scrollWidth,
    overflowX: getComputedStyle(shell).overflowX,
  }))

  expect(overflow.overflowX).toBe("auto")
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth)
})

test("template table auto-generates preview when a row is clicked or a cell is focused", async ({
  page,
}) => {
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "列表" }).click()

  const previewImage = page.locator("img[alt='preview artifact']")
  await expect(previewImage).toHaveCount(0)

  const table = page.getByRole("table")
  const firstRow = table.locator("tbody tr").first()
  await firstRow.click()
  await expect(previewImage).toBeVisible()

  const initialPreviewSrc = await previewImage.getAttribute("src")
  expect(initialPreviewSrc).toBeTruthy()

  const secondRowRecipient = table
    .locator("tbody tr")
    .nth(1)
    .getByRole("button", { name: "Koha Cat" })
  await secondRowRecipient.focus()
  await expect(previewImage).toBeVisible()

  const focusedPreviewSrc = await previewImage.getAttribute("src")
  expect(focusedPreviewSrc).toBeTruthy()
})

test("template table refreshes preview after a debounced edit", async ({ page }) => {
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "列表" }).click()

  const table = page.getByRole("table")
  const firstRow = table.locator("tbody tr").first()
  await firstRow.click()

  const previewImage = page.locator("img[alt='preview artifact']")
  await expect(previewImage).toBeVisible()
  const beforeSrc = await previewImage.getAttribute("src")

  const recipientButton = firstRow.getByRole("button", { name: "Koha Cat" })
  await recipientButton.click()

  const editor = firstRow.locator("input").first()
  await expect(editor).toBeVisible()
  await editor.fill("Koha Cat Updated")

  await page.waitForTimeout(120)
  await expect(previewImage).toBeVisible()

  const midSrc = await previewImage.getAttribute("src")
  expect(midSrc).toBe(beforeSrc)

  await page.waitForTimeout(260)

  await expect.poll(async () => await previewImage.getAttribute("src")).not.toBe(beforeSrc)
})

test("template large mode uses a two-column grid layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "大图" }).click()

  const gridMetrics = await page.locator(".tm-template-list").evaluate((list) => {
    const cards = Array.from(list.querySelectorAll(".tm-template-card"))
    const firstTwo = cards.slice(0, 2).map((card) => {
      const rect = card.getBoundingClientRect()
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
      }
    })

    return {
      templateColumns: getComputedStyle(list).gridTemplateColumns,
      cardCount: cards.length,
      firstTwo,
    }
  })

  expect(gridMetrics.cardCount).toBeGreaterThanOrEqual(2)
  expect(gridMetrics.templateColumns.split(" ").length).toBe(2)
  expect(gridMetrics.firstTwo[0]?.top).toBe(gridMetrics.firstTwo[1]?.top)
  expect(gridMetrics.firstTwo[0]?.left).not.toBe(gridMetrics.firstTwo[1]?.left)
  expect(gridMetrics.firstTwo[0]?.width).toBeGreaterThan(140)
})

test("template large mode keeps two columns in the standard three-pane width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: "大图" }).click()

  const gridMetrics = await page.locator(".tm-template-list").evaluate((list) => {
    const cards = Array.from(list.querySelectorAll(".tm-template-card"))
    const firstTwo = cards.slice(0, 2).map((card) => {
      const rect = card.getBoundingClientRect()
      return {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
      }
    })

    return {
      templateColumns: getComputedStyle(list).gridTemplateColumns,
      cardCount: cards.length,
      firstTwo,
    }
  })

  expect(gridMetrics.cardCount).toBeGreaterThanOrEqual(2)
  expect(gridMetrics.templateColumns.split(" ").length).toBe(2)
  expect(gridMetrics.firstTwo[0]?.top).toBe(gridMetrics.firstTwo[1]?.top)
  expect(gridMetrics.firstTwo[0]?.left).not.toBe(gridMetrics.firstTwo[1]?.left)
  expect(gridMetrics.firstTwo[0]?.width).toBeGreaterThan(120)
})
