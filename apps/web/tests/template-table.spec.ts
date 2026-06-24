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

test("template page keeps a disabled preview rail beside the list before a template is chosen on narrow widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 820 })
  await page.goto("/templates?demo=true")

  const layout = await page.locator("section.tm-workspace").evaluate((workspace) => {
    const leftPane = workspace.querySelector(".tm-pane--left")
    const rightPane = workspace.querySelector(".tm-pane--right")
    if (!leftPane || !rightPane) {
      return null
    }

    const leftRect = leftPane.getBoundingClientRect()
    const rightRect = rightPane.getBoundingClientRect()

    return {
      leftWidth: Math.round(leftRect.width),
      rightWidth: Math.round(rightRect.width),
    }
  })

  expect(layout).not.toBeNull()
  expect(layout?.leftWidth ?? 0).toBeGreaterThan(260)
  expect(layout?.rightWidth ?? 0).toBeGreaterThan(260)
  const rightPane = page.locator(".tm-pane--right")
  await expect(rightPane.getByText("预览与打印", { exact: true })).toBeVisible()
  await expect(rightPane.getByText("先选择模板后查看预览与打印。")).toBeVisible()
  await expect(rightPane.getByRole("button", { name: "生成预览" })).toBeDisabled()
  await expect(rightPane.getByRole("button", { name: "直接打印" })).toBeDisabled()
  await expect(page.getByText("批量录入表")).toHaveCount(0)
})

test("template page collapses to a single outlet flow on narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 820 })
  await page.goto("/templates?demo=true")

  await expect(page.getByText("模板列表")).toBeVisible()
  await expect(page.getByText("批量录入表")).toHaveCount(0)

  await page.getByRole("button", { name: /Compact Shipping Label/ }).click()

  await expect(page.getByText("批量录入表")).toBeVisible()
  await expect(page.getByText("模板列表")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "返回模板" })).toBeVisible()
  await expect(page.locator(".tm-pane--right").getByText("预览与打印", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "返回模板" }).click()
  await expect(page.getByText("模板列表")).toBeVisible()
  await expect(page.getByText("批量录入表")).toHaveCount(0)
})

test("template page moves preview and print below the table on extra narrow widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 930, height: 820 })
  await page.goto("/templates?demo=true")

  await page.getByRole("button", { name: /Compact Shipping Label/ }).click()

  const layout = await page.locator("section.tm-workspace").evaluate((workspace) => {
    const centerPane = workspace.querySelector(".tm-pane--center")
    const rightPane = workspace.querySelector(".tm-pane--right")
    if (!centerPane || !rightPane) {
      return null
    }

    const centerRect = centerPane.getBoundingClientRect()
    const rightRect = rightPane.getBoundingClientRect()

    return {
      centerBottom: Math.round(centerRect.bottom),
      rightTop: Math.round(rightRect.top),
      rightLeft: Math.round(rightRect.left),
      centerLeft: Math.round(centerRect.left),
      rightWidth: Math.round(rightRect.width),
      centerWidth: Math.round(centerRect.width),
    }
  })

  expect(layout).not.toBeNull()
  expect(layout?.rightTop ?? 0).toBeGreaterThanOrEqual((layout?.centerBottom ?? 0) - 1)
  expect(Math.abs((layout?.rightLeft ?? 0) - (layout?.centerLeft ?? 0))).toBeLessThanOrEqual(2)
  expect(Math.abs((layout?.rightWidth ?? 0) - (layout?.centerWidth ?? 0))).toBeLessThanOrEqual(2)
  await expect(page.getByText("预览与打印")).toBeVisible()
})
