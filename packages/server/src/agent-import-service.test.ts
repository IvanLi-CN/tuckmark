import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { AgentImportProposal } from "@tuckmark/inventory"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentImportService } from "./agent-import-service.js"
import { DevdDataService } from "./devd-data-service.js"

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
          recommendedUses: ["electronics"],
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
  it("rejects duplicate agent proposal item IDs before creating a session", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const duplicate = proposal()
    const firstItem = duplicate.items[0]
    if (!firstItem) {
      throw new Error("Mock proposal is missing its first item.")
    }
    duplicate.items = duplicate.items.map((item, index) =>
      index === 1 ? { ...item, id: firstItem.id } : item
    )

    expect(() =>
      service.createSession({
        sessionId: "agent-import-session-duplicate-ids",
        secret,
        proposal: duplicate,
      })
    ).toThrow("Agent import item IDs must be unique.")
  })

  it("recovers a prepared DEVD transaction before listing the import catalog", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const createdAt = "2026-07-02T00:00:00.000Z"
    await mkdir(path.join(dataDir, ".tuckmark", "transactions"), { recursive: true })
    await writeFile(
      path.join(dataDir, ".tuckmark", "transactions", "1-recover-catalog.json"),
      JSON.stringify({
        schema: "tuckmark.devd-data-transaction.v1",
        revision: 1,
        writes: [
          {
            relativePath: "templates/recovered-template/template.json",
            value: {
              id: "recovered-template",
              name: "Recovered mock template",
              description: "Recovered from a mock prepared transaction",
              width: 40,
              height: 20,
              createdAt,
              updatedAt: createdAt,
              archivedAt: null,
              currentVersionId: "recovered-version",
              fieldOrder: [],
              recommendedUses: [],
            },
          },
          {
            relativePath: "templates/recovered-template/versions/recovered-version.json",
            value: {
              id: "recovered-version",
              templateId: "recovered-template",
              version: 1,
              kind: "saved",
              createdAt,
              label: "Recovered mock template",
              document: { fields: [] },
            },
          },
        ],
        deletes: [],
        event: { revision: 1, domains: ["templates"], reason: "mock-recovery" },
      })
    )

    const catalog = await service.catalog()

    expect(catalog.templates).toContainEqual(
      expect.objectContaining({
        source: "user-template",
        id: "recovered-template",
        name: "Recovered mock template",
      })
    )
  })

  it("authenticates a session, exposes template metadata, and commits both intake classes", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)

    const catalog = await service.catalog()
    expect(
      catalog.templates.find((template) => template.id === "cable-tag")?.recommendedUses
    ).toContain("electronics")

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

  it("keeps active restock targets available when a different target is stale", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    await writeFile(
      path.join(dataDir, "inventory", "materials", "archived-material.json"),
      JSON.stringify({
        id: "archived-material",
        fullName: "Archived mock material",
        description: "mock archived data",
        matrixCode: "MOCK-ARCHIVED",
        packagingRemark: "box",
        currentQuantity: 1,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        archivedAt: "2026-07-02T00:00:00.000Z",
        labelBindings: [],
      })
    )
    const activeRestock = proposal().items.find((item) => item.kind === "restock")
    if (!activeRestock) throw new Error("Mock proposal has no restock item.")
    const session = service.createSession({
      sessionId: "agent-import-session-partial-restock-targets",
      secret,
      proposal: {
        schema: "tuckmark.agent-import.v1",
        sourceNote: "mock receipt",
        items: [
          activeRestock,
          {
            ...activeRestock,
            id: "stale-restock-item",
            targetMaterialId: "removed-material",
          },
          {
            ...activeRestock,
            id: "archived-restock-item",
            targetMaterialId: "archived-material",
          },
        ],
      },
    })

    await expect(service.resolveRestockTargets(session.id, secret)).resolves.toEqual([
      expect.objectContaining({
        itemId: activeRestock.id,
        material: expect.objectContaining({ id: "existing-material" }),
      }),
    ])
  })

  it("normalizes server-owned item state in a new proposal", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const invalid = newItemOnlyProposal()
    const item = invalid.items[0]
    if (!item) throw new Error("Mock proposal has no item.")
    invalid.items = [{ ...item, revision: 42, pendingTemplateEventId: "external-event" }]

    const session = service.createSession({
      sessionId: "agent-import-session-external-pending-event",
      secret,
      proposal: invalid,
    })

    expect(session.proposal.items[0]).toMatchObject({
      revision: 0,
      pendingTemplateEventId: null,
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

  it("preserves a restock's immutable target when the confirmation page updates it", async () => {
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
      item: {
        ...restock,
        kind: "new",
        targetMaterialId: "redirected-material",
        targetMaterialUpdatedAt: "2030-01-01T00:00:00.000Z",
        material: {
          ...restock.material,
          fullName: "Redirected mock material",
        },
        quantity: 7,
        sourceNote: "edited mock receipt note",
      },
    })
    expect(updated.proposal.items.find((item) => item.id === restock.id)).toMatchObject({
      kind: "restock",
      targetMaterialId: "existing-material",
      targetMaterialUpdatedAt: "2026-07-01T00:00:00.000Z",
      material: restock.material,
      quantity: 7,
      sourceNote: "edited mock receipt note",
    })
  })

  it("resolves restock display data from the authoritative DEVD target", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-restock-target",
      secret,
      proposal: {
        ...proposal(),
        items: proposal().items.map((item) =>
          item.kind === "restock"
            ? {
                ...item,
                material: {
                  ...item.material,
                  fullName: "Spoofed mock proposal material",
                  baseName: "SPOOF-100",
                  packageName: "SPOOF",
                },
              }
            : item
        ),
      },
    })

    await expect(service.resolveRestockTargets(session.id, secret)).resolves.toEqual([
      expect.objectContaining({
        itemId: "restock-item",
        material: expect.objectContaining({
          id: "existing-material",
          fullName: "Existing mock resistor",
          matrixCode: "MOCK-RES-10K",
        }),
      }),
    ])
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
        material: { ...item.material, matrixCode: " MOCK-RES-10K " },
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

  it("rejects a user template that is absent from the DEVD catalog", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-local-template",
      secret,
      proposal: newItemOnlyProposal(),
    })
    await expect(
      service.requestTemplateInput({
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
      })
    ).rejects.toThrow("Label template user-template:browser-local-template was not found.")
    expect(service.listEvents(session.id, secret)).toHaveLength(0)
    expect((await service.listInventory()).map((material) => material.id)).toEqual([
      "existing-material",
    ])
  })

  it("uses the DEVD catalog fields for a selected template event", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-authoritative-template",
      secret,
      proposal: newItemOnlyProposal(),
    })

    const selected = await service.requestTemplateInput({
      sessionId: session.id,
      secret,
      itemId: "new-item",
      expectedRevision: 0,
      template: {
        source: "system",
        id: "shipping-compact",
        name: "Stale client template",
        fields: [{ key: "wrong", label: "Wrong field", required: true, multiline: false }],
        recommendedUses: [],
      },
    })

    expect(selected.events[0]?.template).toMatchObject({
      source: "system",
      id: "shipping-compact",
      name: "Compact Shipping Label",
    })
    expect(selected.events[0]?.template.fields).toEqual(
      expect.arrayContaining([
        { key: "recipient", label: "Recipient", required: true, multiline: false },
      ])
    )
  })

  it("preserves ordinary item edits while template input is pending", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-1234567890",
      secret,
      proposal: newItemOnlyProposal(),
    })

    const templateChanged = await service.requestTemplateInput({
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
    const edited = service.updateItem({
      sessionId: session.id,
      secret,
      itemId: changedItem.id,
      expectedRevision: changedItem.revision,
      item: { ...changedItem, material: { ...changedItem.material, description: "user edit" } },
    })
    const editedItem = edited.proposal.items[0]
    expect(editedItem?.material.description).toBe("user edit")
    expect(edited.events[0]?.revision).toBe(editedItem?.revision)

    expect(() =>
      service.fulfillTemplateInput({
        sessionId: session.id,
        secret,
        eventId: event.id,
        expectedRevision: event.revision,
        input: { recipient: "Mock recipient", address: "Mock address", orderId: "Mock order" },
      })
    ).toThrow("revision does not match")

    const fulfilled = service.fulfillTemplateInput({
      sessionId: session.id,
      secret,
      eventId: event.id,
      expectedRevision: edited.events[0]?.revision ?? -1,
      input: { recipient: "Mock recipient", address: "Mock address", orderId: "Mock order" },
    })

    expect(fulfilled.events[0]?.status).toBe("fulfilled")
    expect(fulfilled.proposal.items[0]?.pendingTemplateEventId).toBeNull()
    expect(fulfilled.proposal.items[0]?.material.description).toBe("user edit")
  })

  it("persists edited template fields before confirmation", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-template-fields",
      secret,
      proposal: newItemOnlyProposal(),
    })
    const item = session.proposal.items[0]
    if (!item) {
      throw new Error("Mock proposal has no item.")
    }

    service.updateItem({
      sessionId: session.id,
      secret,
      itemId: item.id,
      expectedRevision: item.revision,
      item: { ...item, templateInput: { name: "Edited mock regulator" } },
    })
    await service.confirm(session.id, secret)

    const created = (await service.listInventory()).find(
      (material) => material.fullName === "Mock regulator"
    )
    expect(created?.labelBindings[0]?.fieldOverrides).toEqual({ name: "Edited mock regulator" })
  })

  it("locks a session against edits while its confirmation is committing", async () => {
    const dataDir = await createDataDir()
    const dataService = new DevdDataService(dataDir)
    const service = new AgentImportService(dataDir, dataService)
    const session = service.createSession({
      sessionId: "agent-import-session-commit-lock",
      secret,
      proposal: newItemOnlyProposal(),
    })
    const item = session.proposal.items[0]
    if (!item) throw new Error("Mock proposal has no item.")

    const commit = dataService.commitJsonWrites.bind(dataService)
    let allowCommit: (() => void) | undefined
    const commitBlocked = new Promise<void>((resolve) => {
      allowCommit = resolve
    })
    let enteredCommit: (() => void) | undefined
    const committing = new Promise<void>((resolve) => {
      enteredCommit = resolve
    })
    vi.spyOn(dataService, "commitJsonWrites").mockImplementation(async (args) => {
      enteredCommit?.()
      await commitBlocked
      return await commit(args)
    })

    const confirmation = service.confirm(session.id, secret)
    await committing

    expect(() =>
      service.updateItem({
        sessionId: session.id,
        secret,
        itemId: item.id,
        expectedRevision: item.revision,
        item: { ...item, material: { ...item.material, description: "late mock edit" } },
      })
    ).toThrow("being confirmed")

    allowCommit?.()
    await expect(confirmation).resolves.toMatchObject({ state: "completed" })
  })

  it("keeps the existing template event open when a replacement request is stale", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-invalid-template-request",
      secret,
      proposal: newItemOnlyProposal(),
    })
    const requested = await service.requestTemplateInput({
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
    const event = requested.events[0]
    const item = requested.proposal.items[0]
    if (!event || !item) {
      throw new Error("Mock template event was not created.")
    }

    await expect(
      service.requestTemplateInput({
        sessionId: session.id,
        secret,
        itemId: item.id,
        expectedRevision: item.revision - 1,
        template: item.template ?? event.template,
      })
    ).rejects.toThrow("This import item changed")

    const afterFailure = service.getSession(session.id, secret)
    expect(afterFailure.events).toEqual([event])
    expect(afterFailure.proposal.items[0]?.pendingTemplateEventId).toBe(event.id)
  })

  it("allows confirmation after a pending item is deselected", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-deselect-pending",
      secret,
      proposal: proposal(),
    })
    const requested = await service.requestTemplateInput({
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
    const pendingItem = requested.proposal.items.find((item) => item.id === "new-item")
    if (!pendingItem) {
      throw new Error("Mock pending item was not returned.")
    }

    service.updateItem({
      sessionId: session.id,
      secret,
      itemId: pendingItem.id,
      expectedRevision: pendingItem.revision,
      item: { ...pendingItem, selected: false },
    })

    const completed = await service.confirm(session.id, secret)
    expect(completed.state).toBe("completed")
    expect(
      (await service.listInventory()).find((material) => material.fullName === "Mock regulator")
    ).toBeUndefined()
    expect(
      (await service.listInventory()).find((material) => material.id === "existing-material")
        ?.currentQuantity
    ).toBe(9)
  })

  it("requires every requested template field before accepting an Agent fulfillment", async () => {
    const dataDir = await createDataDir()
    const service = new AgentImportService(dataDir)
    const session = service.createSession({
      sessionId: "agent-import-session-required-template-input",
      secret,
      proposal: newItemOnlyProposal(),
    })
    const changed = await service.requestTemplateInput({
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
    await service.requestTemplateInput({
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
