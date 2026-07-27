import { describe, expect, it } from "vitest"

import {
  applyInventoryAdjustment,
  buildInventoryTemplateInput,
  ensureInventoryMaterialActive,
  ensureInventoryMaterialDeletionAllowed,
  inventoryMaterialSchema,
} from "../src/inventory.js"

describe("inventory plugin", () => {
  const material = inventoryMaterialSchema.parse({
    id: "material-1",
    fullName: "TPS62933DRLR",
    baseName: "TPS62933",
    variantName: "DRLR",
    packageName: "SOT-583",
    description: "同步降压 28V",
    matrixCode: "DM-001",
    packagingRemark: "半卷",
    currentQuantity: 12,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    labelBindings: [],
  })

  it("maps inventory fields into template input defaults", () => {
    const input = buildInventoryTemplateInput(material, {
      id: "binding-1",
      templateSource: "system",
      templateId: "component-bin-sot23",
      templateName: "Component Bin SOT-23",
      printQuantity: 1,
      fieldOverrides: {
        remark: "手动覆盖",
      },
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    })

    expect(input).toMatchObject({
      fullName: "TPS62933DRLR",
      model: "TPS62933DRLR",
      package: "SOT-583",
      remark: "手动覆盖",
      quantity: "12",
      currentQuantity: "12",
    })
  })

  it("applies correction adjustments using an absolute target quantity", () => {
    const result = applyInventoryAdjustment({
      material,
      input: {
        kind: "correction",
        targetQuantity: 8,
        note: "盘点",
        actor: "cli",
      },
      adjustmentId: "adj-1",
    })

    expect(result.material.currentQuantity).toBe(8)
    expect(result.adjustment).toMatchObject({
      kind: "correction",
      quantityDelta: -4,
      quantityAfter: 8,
      targetQuantity: 8,
    })
  })

  it("blocks hard deletion when archived materials still have adjustment history", () => {
    expect(() =>
      ensureInventoryMaterialDeletionAllowed({
        material: {
          ...material,
          archivedAt: "2026-07-20T12:00:00.000Z",
        },
        adjustments: [
          {
            id: "adj-1",
            materialId: material.id,
            kind: "in",
            quantityDelta: 1,
            targetQuantity: null,
            quantityAfter: 13,
            note: "",
            actor: "web",
            createdAt: "2026-07-20T12:00:00.000Z",
          },
        ],
      })
    ).toThrow("已有库存流水的物料只能归档，不能彻底删除。")
  })

  it("blocks archived materials from further stock operations", () => {
    expect(() =>
      ensureInventoryMaterialActive(
        {
          ...material,
          archivedAt: "2026-07-20T12:00:00.000Z",
        },
        "调整库存"
      )
    ).toThrow("已归档物料不能调整库存，请先恢复。")
  })
})
