import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { AgentImportProposal } from "@tuckmark/inventory"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentImportService } from "./agent-import-service.js"

const cleanupPaths: string[] = []
const secret = randomUUID()

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true }))
  )
})

function proposal(overrides: Partial<AgentImportProposal> = {}): AgentImportProposal {
  return {
    schema: "tuckmark.agent-import.v1",
    sourceNote: "mock supplier receipt",
    items: [
      {
        id: "new-item",
        kind: "new",
        selected: true,
        quantity: 5,
        labelPrintQuantity: 3,
        material: {
          fullName: "Mock regulator",
          baseName: "MR-100",
          packageName: "SOT-23",
          description: "Mock component for import testing",
          packagingRemark: "reel",
          datasheets: [
            {
              title: "Manufacturer datasheet",
              url: "https://manufacturer.example/mock-regulator.pdf",
              source: "manufacturer",
            },
          ],
        },
        sourceNote: "mock order row A",
        needsAttention: "Model suffix was inferred from the mock title.",
        template: {
          source: "system",
          id: "cable-tag",
          name: "Cable Tag",
          fields: [{ key: "name", label: "Name", required: true, multiline: false }],
          recommendedUses: [{ scope: "electronics", weight: 90 }],
        },
        templateAlternatives: [],
        templateInput: { name: "Mock regulator" },
        revision: 0,
        pendingTemplateEventId: null,
      },
      {
        id: "restock-item",
        kind: "restock",
        selected: true,
        targetMaterialId: "existing-material",
        targetMaterialUpdatedAt: "2026-07-01T00:00:00.000Z",
        quantity: 2,
        material: {
          fullName: "Existing mock resistor",
          description: "",
          packagingRemark: "",
          datasheets: [],
        },
        sourceNote: "mock order row B",
        templateAlternatives: [],
        templateInput: {},
        revision: 0,
        pendingTemplateEventId: null,
      },
    ],
    ...overrides,
  }
}

function newItemOnlyProposal(): AgentImportProposal {
  const draft = proposal()
  const newItem = draft.items.find((item) => item.kind === "new")
  if (!newItem) {
    throw new Error("Mock proposal has no new item.")
  }
  return { ...draft, items: [newItem] }
}

async function createDataDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-agent-import-"))
  cleanupPaths.push(root)
  await mkdir(path.join(root, "inventory", "materials"), { recursive: true })
  await writeFile(
    path.join(root, "inventory", "materials", "existing-material.json"),
    JSON.stringify({
      id: "existing-material",
      fullName: "Existing mock resistor",
      description: "existing mock data",
      matrixCode: "MOCK-RES-10K",
      packagingRemark: "box",
      currentQuantity: 7,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
      labelBindings: [],
    })
  )
  return root
}

describe("AgentImportService", () => {
  it("authenticates a session, exposes template metadata, and commits both intake classes", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)

    const catalog = await service.catalog()
    expect(
      catalog.templates.find((template) => template.id === "cable-tag")?.recommendedUses
    ).toContainEqual({
      scope: "electronics",
      weight: 90,
    })

    const session = service.createSession({
      sessionId: "agent-import-session-0123456789",
      secret,
      proposal: proposal(),
    })
    expect(() => service.getSession(session.id, "wrong-agent-import-secret")).toThrow(
      "Invalid agent import session key"
    )

    const completed = await service.confirm(session.id, secret)
    expect(completed.state).toBe("completed")

    const existing = JSON.parse(
      await readFile(path.join(dataDir, "inventory", "materials", "existing-material.json"), "utf8")
    ) as { currentQuantity: number }
    expect(existing.currentQuantity).toBe(9)

    const files = await readFile(
      path.join(dataDir, "inventory", "materials", "existing-material.json"),
      "utf8"
    )
    expect(files).toContain("existing-material")

    const materials = await service.listInventory()
    const created = materials.find((material) => material.fullName === "Mock regulator")
    expect(created).toMatchObject({
      currentQuantity: 5,
      labelBindings: [
        {
          templateId: "cable-tag",
          printQuantity: 3,
          fieldOverrides: { name: "Mock regulator" },
        },
      ],
      datasheets: [
        {
          url: "https://manufacturer.example/mock-regulator.pdf",
        },
      ],
    })

    const manifest = JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8")) as {
      counts: { materials: number; adjustments: number }
    }
    expect(manifest.counts).toMatchObject({
      materials: 2,
      adjustments: 2,
    })
  })

  it("accumulates repeated restocks for one material without losing an adjustment", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const restock = proposal().items.find((item) => item.kind === "restock")
    if (!restock) {
      throw new Error("Mock proposal has no restock item.")
    }
    const session = service.createSession({
      sessionId: "agent-import-session-repeated-restock",
      secret,
      proposal: {
        schema: "tuckmark.agent-import.v1",
        sourceNote: "mock receipt",
        items: [
          restock,
          {
            ...restock,
            id: "restock-item-second",
            quantity: 3,
          },
        ],
      },
    })

    await service.confirm(session.id, secret)

    const existing = JSON.parse(
      await readFile(path.join(dataDir, "inventory", "materials", "existing-material.json"), "utf8")
    ) as { currentQuantity: number }
    expect(existing.currentQuantity).toBe(12)
    const adjustments = await service.listInventory()
    expect(
      adjustments.find((material) => material.id === "existing-material")?.currentQuantity
    ).toBe(12)
  })

  it("preserves an item's intake kind when the confirmation page updates it", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-kind-immutable",
      secret,
      proposal: proposal(),
    })
    const restock = session.proposal.items.find((item) => item.kind === "restock")
    if (!restock) throw new Error("Mock proposal has no restock item.")
    const updated = service.updateItem({
      sessionId: session.id,
      secret,
      itemId: restock.id,
      expectedRevision: restock.revision,
      item: { ...restock, kind: "new" },
    })
    expect(updated.proposal.items.find((item) => item.id === restock.id)?.kind).toBe("restock")
  })

  it("enforces matrix-code uniqueness and searches every inventory identity field", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    expect((await service.listInventory("mock-res-10k")).map((material) => material.id)).toEqual([
      "existing-material",
    ])

    const duplicate = newItemOnlyProposal()
    const item = duplicate.items[0]
    if (!item) {
      throw new Error("Mock proposal has no new item.")
    }
    duplicate.items = [
      {
        ...item,
        material: { ...item.material, matrixCode: "MOCK-RES-10K" },
      },
    ]
    const session = service.createSession({
      sessionId: "agent-import-session-duplicate-matrix-code",
      secret,
      proposal: duplicate,
    })

    await expect(service.confirm(session.id, secret)).rejects.toThrow("Matrix code MOCK-RES-10K")
    expect((await service.listInventory()).map((material) => material.id)).toEqual([
      "existing-material",
    ])
  })

  it("copies a manually selected browser-local template into the shared directory", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-local-template",
      secret,
      proposal: newItemOnlyProposal(),
    })
    const selected = service.requestTemplateInput({
      sessionId: session.id,
      secret,
      itemId: "new-item",
      expectedRevision: 0,
      template: {
        source: "user-template",
        id: "browser-local-template",
        name: "Browser-local Mock Template",
        fields: [{ key: "name", label: "Name", required: true, multiline: false }],
        recommendedUses: [],
      },
      localTemplate: {
        template: {
          source: "user-template",
          id: "browser-local-template",
          name: "Browser-local Mock Template",
          fields: [{ key: "name", label: "Name", required: true, multiline: false }],
          recommendedUses: [],
        },
        description: "Mock browser-local template",
        document: {
          version: 1,
          id: "browser-local-document",
          presetId: "mock-preset",
          name: "Browser-local Mock Template",
          width: 50,
          height: 30,
          fields: [
            {
              key: "name",
              label: "Name",
              defaultValue: "",
              multiline: false,
              bindings: [],
            },
          ],
          elements: [],
          editor: { gridEnabled: true, snapEnabled: true },
        },
      },
    })
    const event = selected.events[0]
    if (!event) {
      throw new Error("Mock local-template event was not created.")
    }
    service.fulfillTemplateInput({
      sessionId: session.id,
      secret,
      eventId: event.id,
      expectedRevision: event.revision,
      input: { name: "Mock regulator" },
    })

    await service.confirm(session.id, secret)
    const created = (await service.listInventory()).find(
      (material) => material.fullName === "Mock regulator"
    )
    const binding = created?.labelBindings[0]
    expect(binding?.templateId).toMatch(/^user-template-/u)
    expect(binding?.templateId).not.toBe("browser-local-template")
    expect(
      await readFile(
        path.join(dataDir, "templates", binding?.templateId ?? "missing", "template.json"),
        "utf8"
      )
    ).toContain("Browser-local Mock Template")
  })

  it("rejects item edits while template input is pending", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-1234567890",
      secret,
      proposal: newItemOnlyProposal(),
    })

    const templateChanged = service.requestTemplateInput({
      sessionId: session.id,
      secret,
      itemId: "new-item",
      expectedRevision: 0,
      template: {
        source: "system",
        id: "shipping-compact",
        name: "Compact Shipping Label",
        fields: [{ key: "recipient", label: "Recipient", required: true, multiline: false }],
        recommendedUses: [],
      },
    })
    const event = templateChanged.events[0]
    expect(event?.status).toBe("open")
    if (!event) {
      throw new Error("Mock template event was not created.")
    }

    const changedItem = templateChanged.proposal.items[0]
    if (!changedItem) {
      throw new Error("Mock item was not returned.")
    }
    expect(() =>
      service.updateItem({
        sessionId: session.id,
        secret,
        itemId: changedItem.id,
        expectedRevision: changedItem.revision,
        item: { ...changedItem, material: { ...changedItem.material, description: "user edit" } },
      })
    ).toThrow("Template input is pending")

    const fulfilled = service.fulfillTemplateInput({
      sessionId: session.id,
      secret,
      eventId: event.id,
      expectedRevision: event.revision,
      input: { recipient: "Mock recipient" },
    })

    expect(fulfilled.events[0]?.status).toBe("fulfilled")
    expect(fulfilled.proposal.items[0]?.pendingTemplateEventId).toBeNull()
  })

  it("requires every requested template field before accepting an Agent fulfillment", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-required-template-input",
      secret,
      proposal: newItemOnlyProposal(),
    })
    const changed = service.requestTemplateInput({
      sessionId: session.id,
      secret,
      itemId: "new-item",
      expectedRevision: 0,
      template: {
        source: "system",
        id: "shipping-compact",
        name: "Compact Shipping Label",
        fields: [{ key: "recipient", label: "Recipient", required: true, multiline: false }],
        recommendedUses: [],
      },
    })
    const event = changed.events[0]
    if (!event) {
      throw new Error("Mock template event was not created.")
    }

    expect(() =>
      service.fulfillTemplateInput({
        sessionId: session.id,
        secret,
        eventId: event.id,
        expectedRevision: event.revision,
        input: {},
      })
    ).toThrow("Recipient")
    expect(service.listEvents(session.id, secret)).toHaveLength(1)
  })

  it("rejects confirmation while template input remains pending", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-pending-confirm",
      secret,
      proposal: newItemOnlyProposal(),
    })
    const item = session.proposal.items[0]
    if (!item) throw new Error("Mock proposal has no item.")
    service.requestTemplateInput({
      sessionId: session.id,
      secret,
      itemId: item.id,
      expectedRevision: item.revision,
      template: {
        source: "system",
        id: "cable-tag",
        name: "Cable",
        fields: [],
        recommendedUses: [],
      },
    })
    await expect(service.confirm(session.id, secret)).rejects.toThrow("still pending")
  })

  it("rejects a new-material binding for a template absent from the catalog", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const draft = newItemOnlyProposal()
    const item = draft.items[0]
    if (!item) {
      throw new Error("Mock proposal has no new item.")
    }
    draft.items = [
      {
        ...item,
        template: {
          source: "system",
          id: "missing-template",
          name: "Missing Template",
          fields: [],
          recommendedUses: [],
        },
      },
    ]
    const session = service.createSession({
      sessionId: "agent-import-session-missing-template",
      secret,
      proposal: draft,
    })

    await expect(service.confirm(session.id, secret)).rejects.toThrow("was not found")
    expect((await service.listInventory()).map((material) => material.id)).toEqual([
      "existing-material",
    ])
  })

  it("rejects invalid restocks without writing the preceding new material", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const invalid = proposal()
    const restock = invalid.items.find((item) => item.kind === "restock")
    if (!restock) {
      throw new Error("Mock proposal has no restock item.")
    }
    invalid.items = invalid.items.map((item) =>
      item.id === restock.id
        ? {
            ...restock,
            targetMaterialId: "missing-material",
            targetMaterialUpdatedAt: undefined,
          }
        : item
    )
    const session = service.createSession({
      sessionId: "agent-import-session-9876543210",
      secret,
      proposal: invalid,
    })

    await expect(service.confirm(session.id, secret)).rejects.toThrow("was not found")
    const materials = await service.listInventory()
    expect(materials.map((material) => material.id)).toEqual(["existing-material"])
  })

  it("rejects a restock that lacks the session target timestamp", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const invalid = proposal()
    invalid.items = invalid.items.map((item) =>
      item.kind === "restock" ? { ...item, targetMaterialUpdatedAt: undefined } : item
    )
    const session = service.createSession({
      sessionId: "agent-import-session-missing-target-timestamp",
      secret,
      proposal: invalid,
    })

    await expect(service.confirm(session.id, secret)).rejects.toThrow(
      "missing its session timestamp"
    )
    expect((await service.listInventory()).map((material) => material.id)).toEqual([
      "existing-material",
    ])
  })

  it("removes expired sessions", async () => {
    vi.useFakeTimers()
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-expiration",
      secret,
      proposal: newItemOnlyProposal(),
    })

    vi.advanceTimersByTime(30 * 60 * 1000 + 1)
    expect(() => service.getSession(session.id, secret)).toThrow("has expired")
  })
})
