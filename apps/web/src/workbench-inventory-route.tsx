import {
  buildInventoryMaterialFieldMap,
  buildInventoryTemplateInput,
  type InventoryAdjustment,
  type InventoryAdjustmentInput,
  type InventoryMaterial,
  type InventoryTemplateBinding,
} from "@tuckmark/inventory"
import {
  Archive,
  ChevronLeft,
  PackagePlus,
  Printer,
  RefreshCcw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react"
import React from "react"

import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Button } from "./components/ui/button.js"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js"
import { Input } from "./components/ui/input.js"
import { Label } from "./components/ui/label.js"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.js"
import { Textarea } from "./components/ui/textarea.js"
import {
  applyInventoryMaterialAdjustment,
  archiveInventoryMaterial,
  deleteInventoryMaterial,
  listInventoryAdjustments,
  listInventoryMaterials,
  restoreInventoryMaterial,
  saveInventoryMaterial,
} from "./inventory-data-store.js"
import { cn } from "./lib/utils.js"
import type { Template, UserTemplateSummary } from "./types.js"
import { loadWorkingCopy, readUserTemplateHistory } from "./user-template-store.js"
import {
  createTemplatePrintSource,
  createUserTemplatePrintSource,
  EmptyMini,
  PreviewCard,
} from "./workbench-app.js"
import type { WorkbenchController } from "./workbench-controller.js"
import { useWorkbenchNavigate } from "./workbench-navigation.js"

type TemplateOption =
  | {
      id: string
      source: "system"
      name: string
      description: string
      fields: Array<{ key: string; label: string }>
      template: Template
    }
  | {
      id: string
      source: "user-template"
      name: string
      description: string
      fields: Array<{ key: string; label: string }>
      template: UserTemplateSummary
    }

type MaterialDraft = {
  id?: string
  fullName: string
  baseName: string
  variantName: string
  packageName: string
  description: string
  matrixCode: string
  packagingRemark: string
}

type BindingDraft = {
  id?: string
  templateSource: "system" | "user-template"
  templateId: string
  printQuantity: string
  fieldOverrides: Record<string, string>
}

function createEmptyMaterialDraft(): MaterialDraft {
  return {
    fullName: "",
    baseName: "",
    variantName: "",
    packageName: "",
    description: "",
    matrixCode: "",
    packagingRemark: "",
  }
}

function materialToDraft(material: InventoryMaterial): MaterialDraft {
  return {
    id: material.id,
    fullName: material.fullName,
    baseName: material.baseName ?? "",
    variantName: material.variantName ?? "",
    packageName: material.packageName ?? "",
    description: material.description,
    matrixCode: material.matrixCode ?? "",
    packagingRemark: material.packagingRemark,
  }
}

function createEmptyBindingDraft(): BindingDraft {
  return {
    templateSource: "system",
    templateId: "",
    printQuantity: "1",
    fieldOverrides: {},
  }
}

function bindingToDraft(binding: InventoryTemplateBinding): BindingDraft {
  return {
    id: binding.id,
    templateSource: binding.templateSource,
    templateId: binding.templateId,
    printQuantity: String(binding.printQuantity),
    fieldOverrides: binding.fieldOverrides,
  }
}

async function resolveUserTemplateDraft(
  template: UserTemplateSummary
): Promise<UserTemplateSummary["document"]> {
  if (template.document) {
    return template.document
  }
  const workingCopy = await loadWorkingCopy({
    kind: "user-template",
    templateId: template.id,
  })
  if (workingCopy?.draft) {
    return workingCopy.draft
  }
  const history = await readUserTemplateHistory(template.id)
  return (
    history?.saved.find((item) => item.id === history.template.currentVersionId)?.document ??
    history?.saved[0]?.document ??
    null
  )
}

function serializeBinding(option: TemplateOption, draft: BindingDraft): InventoryTemplateBinding {
  return {
    id: draft.id ?? `inventory-binding-${crypto.randomUUID()}`,
    templateSource: option.source,
    templateId: option.id,
    templateName: option.name,
    printQuantity: Math.max(1, Number.parseInt(draft.printQuantity, 10) || 1),
    fieldOverrides: Object.fromEntries(
      Object.entries(draft.fieldOverrides)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value.length > 0)
    ),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export default function WorkbenchInventoryRoute({
  controller,
  materialId,
  onRouteChunkReady,
}: {
  controller: WorkbenchController
  materialId?: string
  onRouteChunkReady?: () => void
}) {
  const storyState = controller.inventoryStoryState
  const startupReady = storyState ? true : controller.startupSyncReady
  const navigate = useWorkbenchNavigate()
  const isDetailRoute = typeof materialId === "string" && materialId.length > 0
  const isNewMaterialRoute = materialId === "new"
  const selectedMaterialId = isDetailRoute && !isNewMaterialRoute && materialId ? materialId : ""
  const templateOptions = React.useMemo<TemplateOption[]>(
    () => [
      ...controller.templates.map(
        (template) =>
          ({
            id: template.id,
            source: "system",
            name: template.name,
            description: template.description,
            fields: template.fields.map((field) => ({ key: field.key, label: field.label })),
            template,
          }) satisfies TemplateOption
      ),
      ...controller.userTemplates.map(
        (template) =>
          ({
            id: template.id,
            source: "user-template",
            name: template.name,
            description: template.description,
            fields: template.fields.map((field) => ({ key: field.key, label: field.label })),
            template,
          }) satisfies TemplateOption
      ),
    ],
    [controller.templates, controller.userTemplates]
  )
  const [loading, setLoading] = React.useState(!startupReady)
  const [error, setError] = React.useState<string | null>(null)
  const [materials, setMaterials] = React.useState<InventoryMaterial[]>(storyState?.materials ?? [])
  const [materialDraft, setMaterialDraft] = React.useState<MaterialDraft>(createEmptyMaterialDraft)
  const [search, setSearch] = React.useState("")
  const [showArchived, setShowArchived] = React.useState(false)
  const [adjustments, setAdjustments] = React.useState<InventoryAdjustment[]>(
    storyState?.adjustments ?? []
  )
  const [adjustmentKind, setAdjustmentKind] = React.useState<InventoryAdjustmentInput["kind"]>("in")
  const [adjustmentValue, setAdjustmentValue] = React.useState("1")
  const [adjustmentNote, setAdjustmentNote] = React.useState("")
  const [bindingDraft, setBindingDraft] = React.useState<BindingDraft>(createEmptyBindingDraft)
  const [editingBindingId, setEditingBindingId] = React.useState<string | null>(null)
  const [printBindingId, setPrintBindingId] = React.useState("")
  const [printQuantity, setPrintQuantity] = React.useState("1")

  const selectedMaterial = React.useMemo(
    () => materials.find((material) => material.id === selectedMaterialId) ?? null,
    [materials, selectedMaterialId]
  )
  const selectedTemplateOption = React.useMemo(
    () =>
      templateOptions.find(
        (option) =>
          option.id === bindingDraft.templateId && option.source === bindingDraft.templateSource
      ) ?? null,
    [bindingDraft.templateId, bindingDraft.templateSource, templateOptions]
  )
  const selectedMaterialArchived = Boolean(selectedMaterial?.archivedAt)
  const selectedMaterialBindingCount = selectedMaterial?.labelBindings.length ?? 0
  const selectedPrintBinding = React.useMemo(
    () =>
      selectedMaterial?.labelBindings.find((binding) => binding.id === printBindingId) ??
      selectedMaterial?.labelBindings[0] ??
      null,
    [printBindingId, selectedMaterial]
  )

  const refresh = React.useCallback(
    async (query = search) => {
      if (!startupReady) {
        setLoading(true)
        return
      }
      if (storyState) {
        setMaterials(storyState.materials)
        setAdjustments(
          selectedMaterialId
            ? storyState.adjustments.filter((item) => item.materialId === selectedMaterialId)
            : []
        )
        return
      }
      setLoading(true)
      setError(null)
      try {
        const nextMaterials = await listInventoryMaterials(isDetailRoute ? "" : query, {
          includeArchived: isDetailRoute ? true : showArchived,
        })
        setMaterials(nextMaterials)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setLoading(false)
      }
    },
    [isDetailRoute, search, selectedMaterialId, showArchived, startupReady, storyState]
  )

  React.useEffect(() => {
    onRouteChunkReady?.()
  }, [onRouteChunkReady])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (storyState) {
      return
    }
    if (!startupReady || !selectedMaterialId) {
      setAdjustments([])
      return
    }

    let cancelled = false
    void listInventoryAdjustments(selectedMaterialId)
      .then((nextAdjustments) => {
        if (!cancelled) {
          setAdjustments(nextAdjustments)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedMaterialId, startupReady, storyState])

  React.useEffect(() => {
    if (!selectedMaterial) {
      setMaterialDraft(createEmptyMaterialDraft())
      setBindingDraft(createEmptyBindingDraft())
      setEditingBindingId(null)
      setPrintBindingId("")
      return
    }
    setMaterialDraft(materialToDraft(selectedMaterial))
    const defaultBinding = selectedMaterial.labelBindings[0]
    if (defaultBinding) {
      setPrintBindingId(defaultBinding.id)
      setPrintQuantity(String(defaultBinding.printQuantity))
    } else {
      setPrintBindingId("")
      setPrintQuantity("1")
    }
  }, [selectedMaterial])

  React.useEffect(() => {
    if (!selectedPrintBinding) {
      setPrintQuantity("1")
      return
    }
    setPrintQuantity(String(selectedPrintBinding.printQuantity))
  }, [selectedPrintBinding])

  const saveMaterial = React.useCallback(async () => {
    if (selectedMaterialArchived) {
      setError("已归档物料不能编辑，请先恢复。")
      return
    }
    try {
      const saved = await saveInventoryMaterial({
        ...materialDraft,
        id: materialDraft.id,
        labelBindings: selectedMaterial?.labelBindings ?? [],
      })
      await refresh()
      await navigate(`/inventory/${saved.id}`, {
        replace: isNewMaterialRoute || materialId !== saved.id,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [
    isNewMaterialRoute,
    materialDraft,
    navigate,
    refresh,
    materialId,
    selectedMaterial?.labelBindings,
    selectedMaterialArchived,
  ])

  const saveBinding = React.useCallback(async () => {
    if (!selectedMaterial || !selectedTemplateOption) {
      setError("先选择一个模板，再保存标签关联。")
      return
    }
    if (selectedMaterial.archivedAt) {
      setError("已归档物料不能修改标签关联，请先恢复。")
      return
    }
    try {
      const nextBinding = serializeBinding(selectedTemplateOption, bindingDraft)
      const nextBindings = selectedMaterial.labelBindings.some(
        (binding) => binding.id === nextBinding.id
      )
        ? selectedMaterial.labelBindings.map((binding) =>
            binding.id === nextBinding.id ? nextBinding : binding
          )
        : [...selectedMaterial.labelBindings, nextBinding]
      await saveInventoryMaterial({
        ...materialToDraft(selectedMaterial),
        id: selectedMaterial.id,
        labelBindings: nextBindings,
      })
      setBindingDraft(createEmptyBindingDraft())
      setEditingBindingId(null)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [bindingDraft, refresh, selectedMaterial, selectedTemplateOption])

  const removeBinding = React.useCallback(
    async (bindingId: string) => {
      if (!selectedMaterial) {
        return
      }
      if (selectedMaterial.archivedAt) {
        setError("已归档物料不能修改标签关联，请先恢复。")
        return
      }
      try {
        await saveInventoryMaterial({
          ...materialToDraft(selectedMaterial),
          id: selectedMaterial.id,
          labelBindings: selectedMaterial.labelBindings.filter(
            (binding) => binding.id !== bindingId
          ),
        })
        if (printBindingId === bindingId) {
          setPrintBindingId("")
        }
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [printBindingId, refresh, selectedMaterial]
  )

  const submitAdjustment = React.useCallback(async () => {
    if (!selectedMaterial) {
      setError("先选择一个物料。")
      return
    }
    if (selectedMaterial.archivedAt) {
      setError("已归档物料不能调整库存，请先恢复。")
      return
    }
    try {
      const numericValue = Math.max(0, Number.parseInt(adjustmentValue, 10) || 0)
      const input: InventoryAdjustmentInput =
        adjustmentKind === "correction"
          ? {
              kind: "correction",
              targetQuantity: numericValue,
              note: adjustmentNote,
              actor: "web",
            }
          : {
              kind: adjustmentKind,
              quantity: Math.max(1, numericValue),
              note: adjustmentNote,
              actor: "web",
            }
      const result = await applyInventoryMaterialAdjustment({
        materialId: selectedMaterial.id,
        input,
      })
      setAdjustmentNote("")
      setAdjustments((current) => [result.adjustment, ...current])
      setMaterials((current) =>
        current.map((material) => (material.id === result.material.id ? result.material : material))
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [adjustmentKind, adjustmentNote, adjustmentValue, selectedMaterial])

  const printSelectedBinding = React.useCallback(async () => {
    if (!selectedMaterial || !selectedPrintBinding) {
      setError("先选择一个标签模板。")
      return
    }
    if (selectedMaterial.archivedAt) {
      setError("已归档物料不能打印标签，请先恢复。")
      return
    }
    const option = templateOptions.find(
      (item) =>
        item.id === selectedPrintBinding.templateId &&
        item.source === selectedPrintBinding.templateSource
    )
    if (!option) {
      setError("关联模板不存在，可能已被移除。")
      return
    }

    const row = {
      id: selectedPrintBinding.id,
      values: {
        ...buildInventoryTemplateInput(selectedMaterial, selectedPrintBinding),
        quantity: printQuantity,
        currentQuantity: String(selectedMaterial.currentQuantity),
      },
    }

    try {
      if (option.source === "system") {
        await controller.printSourceDirect(
          createTemplatePrintSource(option.template, row, controller.renderOptions)
        )
        return
      }

      const draft = await resolveUserTemplateDraft(option.template)
      if (!draft) {
        throw new Error("用户模板当前没有可用画布版本。")
      }
      await controller.printSourceDirect(
        createUserTemplatePrintSource(option.template, draft, row, controller.renderOptions)
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [controller, printQuantity, selectedMaterial, selectedPrintBinding, templateOptions])

  const selectedMaterialFieldMap = selectedMaterial
    ? buildInventoryMaterialFieldMap(selectedMaterial)
    : null
  const materialStats = React.useMemo(
    () => ({
      visibleCount: materials.length,
      archivedCount: materials.filter((material) => Boolean(material.archivedAt)).length,
      totalQuantity: materials.reduce((total, material) => total + material.currentQuantity, 0),
    }),
    [materials]
  )
  const detailRouteUnavailable =
    isDetailRoute && !isNewMaterialRoute && startupReady && !loading && !selectedMaterial
  const listEmptyText =
    search.trim().length > 0 || showArchived ? "没有符合当前筛选条件的物料。" : "还没有库存物料。"
  const detailTitle = isNewMaterialRoute ? "新建物料" : (selectedMaterial?.fullName ?? "物料详情")
  const detailNote = isNewMaterialRoute
    ? "先完成物料资料，再进入库存调整、打印与流水查看。"
    : "先核对物料信息与标签模板，再处理库存调整和手动打印。"
  const detailMeta = selectedMaterial
    ? [
        selectedMaterial.packageName ? `封装 ${selectedMaterial.packageName}` : null,
        selectedMaterial.matrixCode ? `矩阵码 ${selectedMaterial.matrixCode}` : null,
        `库存 ${selectedMaterial.currentQuantity}`,
      ].filter((value): value is string => Boolean(value))
    : []

  return (
    <section className="tm-inventory">
      {!isDetailRoute ? (
        <>
          {!startupReady ? (
            <Alert>
              <AlertTitle>正在初始化库存工作台</AlertTitle>
              <AlertDescription>正在读取模板、目录状态与库存索引，请稍候。</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>库存操作失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="tm-inventory__page-head">
            <div className="tm-inventory__section-head">
              <strong className="tm-inventory__page-title">物料列表</strong>
              <p className="tm-inventory__page-note">
                先看关键库存，再筛选物料，单个物料的标签、调整和打印都放进独立详情页处理。
              </p>
            </div>
            <Button
              className="tm-inventory__page-action"
              type="button"
              onClick={() => {
                void navigate("/inventory/new")
              }}
            >
              <PackagePlus className="size-4" />
              <span>新建物料</span>
            </Button>
          </div>
          <div className="tm-inventory__catalog-layout">
            <div className="tm-inventory__catalog-sidebar">
              <div className="tm-inventory__stats">
                <div className="tm-inventory__stat-card">
                  <span className="tm-inventory__stat-label">当前结果</span>
                  <strong className="tm-inventory__stat-value">{materialStats.visibleCount}</strong>
                </div>
                <div className="tm-inventory__stat-card tm-inventory__stat-card--accent">
                  <span className="tm-inventory__stat-label">合计库存</span>
                  <strong className="tm-inventory__stat-value">
                    {materialStats.totalQuantity}
                  </strong>
                </div>
                <div className="tm-inventory__stat-card">
                  <span className="tm-inventory__stat-label">已归档</span>
                  <strong className="tm-inventory__stat-value">
                    {materialStats.archivedCount}
                  </strong>
                </div>
              </div>
              <Card className="tm-panel tm-inventory__filters">
                <CardHeader className="pb-2">
                  <CardTitle as="h2">搜索</CardTitle>
                  <p className="tm-inventory__section-note">按型号、封装、矩阵码筛选当前物料。</p>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="inventory-search">搜索</Label>
                    <Input
                      id="inventory-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="型号、封装、矩阵码"
                    />
                  </div>
                  <div className="tm-inventory__toolbar">
                    <Button type="button" variant="outline" onClick={() => void refresh(search)}>
                      <RefreshCcw className="size-4" />
                      <span>刷新</span>
                    </Button>
                    <Button
                      type="button"
                      variant={showArchived ? "secondary" : "outline"}
                      onClick={() => setShowArchived((current) => !current)}
                    >
                      <Archive className="size-4" />
                      <span>{showArchived ? "隐藏已归档" : "显示已归档"}</span>
                    </Button>
                  </div>
                  <Button
                    className="tm-inventory__panel-action"
                    type="button"
                    onClick={() => {
                      void navigate("/inventory/new")
                    }}
                  >
                    <PackagePlus className="size-4" />
                    <span>新建物料</span>
                  </Button>
                </CardContent>
              </Card>
            </div>
            <Card className="tm-panel tm-inventory__results">
              <CardHeader className="tm-inventory__results-header">
                <div className="tm-inventory__results-lead">
                  <CardTitle as="h2" className="tm-inventory__results-title">
                    列表
                  </CardTitle>
                  <span className="tm-inventory__list-count">{materialStats.visibleCount} 项</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="tm-inventory__list-surface">
                  {materials.length === 0 ? (
                    <div className="tm-inventory__results-empty">
                      <EmptyMini text={listEmptyText} />
                    </div>
                  ) : (
                    <>
                      <div className="tm-inventory__table-head" aria-hidden="true">
                        <span>物料</span>
                        <span>封装</span>
                        <span>库存</span>
                        <span>状态</span>
                      </div>
                      <div className="tm-inventory__table-body">
                        {materials.map((material) => (
                          <button
                            key={material.id}
                            type="button"
                            className="tm-inventory__row"
                            onClick={() => {
                              void navigate(`/inventory/${material.id}`)
                            }}
                          >
                            <span className="tm-inventory__row-main">
                              <strong className="tm-inventory__row-title">
                                {material.fullName}
                              </strong>
                              <small className="tm-inventory__row-meta">
                                {[material.description || "未填写描述", material.matrixCode]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            </span>
                            <span className="tm-inventory__row-cell tm-inventory__row-cell--package">
                              {material.packageName || "未填写"}
                            </span>
                            <span className="tm-inventory__row-cell tm-inventory__row-cell--quantity">
                              {material.currentQuantity}
                            </span>
                            <span
                              className={cn(
                                "tm-inventory__row-cell tm-inventory__row-cell--status",
                                material.archivedAt
                                  ? "tm-inventory__row-cell--status-archived"
                                  : "tm-inventory__row-cell--status-live"
                              )}
                            >
                              {material.archivedAt ? "已归档" : "活跃"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <>
          <div className="tm-inventory-detail__header">
            <div className="tm-inventory-detail__header-bar">
              <Button
                type="button"
                variant="outline"
                className="tm-inventory-detail__back"
                onClick={() => void navigate("/inventory")}
              >
                <ChevronLeft className="size-4" />
                <span>返回列表</span>
              </Button>
              <span className="tm-inventory-detail__eyebrow">库存详情</span>
            </div>
            <div className="tm-inventory-detail__hero">
              <div className="tm-inventory-detail__copy">
                <strong className="tm-inventory-detail__title">{detailTitle}</strong>
                <p className="tm-inventory-detail__note">{detailNote}</p>
                {detailMeta.length > 0 ? (
                  <div className="tm-inventory-detail__meta">
                    {detailMeta.map((item) => (
                      <span key={item} className="tm-inventory-detail__pill">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="tm-inventory-detail__summary">
                <div className="tm-inventory-detail__summary-card">
                  <span className="tm-inventory-detail__summary-label">标签模板</span>
                  <strong className="tm-inventory-detail__summary-value">
                    {selectedMaterialBindingCount}
                  </strong>
                  <span className="tm-inventory-detail__summary-note">
                    {selectedMaterialBindingCount > 0
                      ? "已为当前物料准备打印入口。"
                      : "还没有关联可打印标签模板。"}
                  </span>
                </div>
                <div className="tm-inventory-detail__summary-card tm-inventory-detail__summary-card--accent">
                  <span className="tm-inventory-detail__summary-label">物料状态</span>
                  <strong className="tm-inventory-detail__summary-value">
                    {selectedMaterialArchived ? "已归档" : "活跃"}
                  </strong>
                  <span className="tm-inventory-detail__summary-note">
                    {selectedMaterialArchived
                      ? "当前物料保持停用，仅保留库存与打印记录。"
                      : "当前物料可继续调整库存与手动打印。"}
                  </span>
                </div>
              </div>
            </div>
          </div>
          {!startupReady ? (
            <Alert>
              <AlertTitle>正在初始化库存工作台</AlertTitle>
              <AlertDescription>正在读取模板、目录状态与库存索引，请稍候。</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>库存操作失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {detailRouteUnavailable ? (
            <Card className="tm-panel">
              <CardContent className="grid gap-4 py-8">
                <EmptyMini text="没有找到这个物料，可能已被删除，或者当前数据里已经不存在。" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void navigate("/inventory")}>
                    <ChevronLeft className="size-4" />
                    <span>返回列表</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void navigate("/inventory/new")}
                  >
                    <PackagePlus className="size-4" />
                    <span>新建物料</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="tm-inventory-detail__layout">
              <div className="tm-inventory-detail__main">
                <Card className="tm-panel">
                  <CardHeader className="pb-2">
                    <CardTitle as="h2">物料信息</CardTitle>
                    <p className="tm-inventory__section-note">
                      完整型号唯一，可拆主名称/次名称，描述当前这一个物料。
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="tm-inventory__form-grid">
                      <div className="grid gap-2">
                        <Label htmlFor="inventory-full-name">完整型号</Label>
                        <Input
                          id="inventory-full-name"
                          value={materialDraft.fullName}
                          disabled={selectedMaterialArchived}
                          onChange={(event) =>
                            setMaterialDraft((current) => ({
                              ...current,
                              fullName: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="inventory-base-name">主名称</Label>
                        <Input
                          id="inventory-base-name"
                          value={materialDraft.baseName}
                          disabled={selectedMaterialArchived}
                          onChange={(event) =>
                            setMaterialDraft((current) => ({
                              ...current,
                              baseName: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="inventory-variant-name">次名称</Label>
                        <Input
                          id="inventory-variant-name"
                          value={materialDraft.variantName}
                          disabled={selectedMaterialArchived}
                          onChange={(event) =>
                            setMaterialDraft((current) => ({
                              ...current,
                              variantName: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="inventory-package-name">封装</Label>
                        <Input
                          id="inventory-package-name"
                          value={materialDraft.packageName}
                          disabled={selectedMaterialArchived}
                          onChange={(event) =>
                            setMaterialDraft((current) => ({
                              ...current,
                              packageName: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="inventory-matrix-code">矩阵码</Label>
                        <Input
                          id="inventory-matrix-code"
                          value={materialDraft.matrixCode}
                          disabled={selectedMaterialArchived}
                          onChange={(event) =>
                            setMaterialDraft((current) => ({
                              ...current,
                              matrixCode: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="inventory-packaging-remark">包装备注</Label>
                        <Input
                          id="inventory-packaging-remark"
                          value={materialDraft.packagingRemark}
                          disabled={selectedMaterialArchived}
                          onChange={(event) =>
                            setMaterialDraft((current) => ({
                              ...current,
                              packagingRemark: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="inventory-description">简要描述</Label>
                      <Textarea
                        id="inventory-description"
                        value={materialDraft.description}
                        disabled={selectedMaterialArchived}
                        onChange={(event) =>
                          setMaterialDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        rows={3}
                      />
                    </div>
                    {selectedMaterialArchived ? (
                      <Alert>
                        <AlertTitle>当前物料已归档</AlertTitle>
                        <AlertDescription>
                          归档物料会保留库存与流水记录，但不能继续编辑、调库存或打印标签。
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => void saveMaterial()}
                        disabled={selectedMaterialArchived}
                      >
                        <Save className="size-4" />
                        <span>{selectedMaterial ? "保存物料" : "创建物料"}</span>
                      </Button>
                      {selectedMaterial ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              void (selectedMaterial.archivedAt
                                ? restoreInventoryMaterial(selectedMaterial.id).then(() =>
                                    refresh()
                                  )
                                : archiveInventoryMaterial(selectedMaterial.id).then(() =>
                                    refresh()
                                  ))
                            }
                          >
                            {selectedMaterial.archivedAt ? (
                              <Undo2 className="size-4" />
                            ) : (
                              <Archive className="size-4" />
                            )}
                            <span>{selectedMaterial.archivedAt ? "恢复物料" : "归档物料"}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              void deleteInventoryMaterial(selectedMaterial.id)
                                .then(async () => {
                                  setMaterials((current) =>
                                    current.filter(
                                      (material) => material.id !== selectedMaterial.id
                                    )
                                  )
                                  setAdjustments([])
                                  await navigate("/inventory", { replace: true })
                                })
                                .catch((cause) =>
                                  setError(cause instanceof Error ? cause.message : String(cause))
                                )
                            }
                          >
                            <Trash2 className="size-4" />
                            <span>删除物料</span>
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <Card className="tm-panel">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="tm-inventory__section-head">
                        <CardTitle as="h2">标签模板关联</CardTitle>
                        <p className="tm-inventory__section-note">
                          默认同名字段自动填充，可按模板字段覆盖具体值。
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!selectedMaterial || selectedMaterialArchived}
                        onClick={() => {
                          setBindingDraft(createEmptyBindingDraft())
                          setEditingBindingId(null)
                        }}
                      >
                        <PackagePlus className="size-4" />
                        <span>新增关联</span>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    {selectedMaterial?.labelBindings.length ? (
                      <div className="grid gap-2">
                        {selectedMaterial.labelBindings.map((binding) => (
                          <div key={binding.id} className="tm-list-item">
                            <span>
                              <strong>{binding.templateName}</strong>
                              <small className="block text-muted-foreground">
                                {binding.templateSource === "system" ? "系统模板" : "用户模板"} ·
                                默认打印 {binding.printQuantity}
                              </small>
                            </span>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={selectedMaterialArchived}
                                onClick={() => {
                                  setBindingDraft(bindingToDraft(binding))
                                  setEditingBindingId(binding.id)
                                }}
                              >
                                编辑
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={selectedMaterialArchived}
                                onClick={() => void removeBinding(binding.id)}
                              >
                                删除
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyMini
                        text={
                          selectedMaterial
                            ? "当前物料还没有关联标签模板。"
                            : "先保存物料，再配置它的标签模板关联。"
                        }
                      />
                    )}
                    <div className="tm-inventory__form-grid">
                      <div className="grid gap-2">
                        <Label>模板来源</Label>
                        <Select
                          value={bindingDraft.templateSource}
                          disabled={!selectedMaterial || selectedMaterialArchived}
                          onValueChange={(value: "system" | "user-template") =>
                            setBindingDraft((current) => ({
                              ...current,
                              templateSource: value,
                              templateId: "",
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择模板来源" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="system">系统模板</SelectItem>
                            <SelectItem value="user-template">用户模板</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label>模板</Label>
                        <Select
                          value={bindingDraft.templateId}
                          disabled={!selectedMaterial || selectedMaterialArchived}
                          onValueChange={(value) =>
                            setBindingDraft((current) => ({ ...current, templateId: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="选择模板" />
                          </SelectTrigger>
                          <SelectContent>
                            {templateOptions
                              .filter((option) => option.source === bindingDraft.templateSource)
                              .map((option) => (
                                <SelectItem key={`${option.source}:${option.id}`} value={option.id}>
                                  {option.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="inventory-binding-print-quantity">默认打印数量</Label>
                        <Input
                          id="inventory-binding-print-quantity"
                          inputMode="numeric"
                          value={bindingDraft.printQuantity}
                          disabled={!selectedMaterial || selectedMaterialArchived}
                          onChange={(event) =>
                            setBindingDraft((current) => ({
                              ...current,
                              printQuantity: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    {selectedTemplateOption && selectedMaterialFieldMap ? (
                      <div className="grid gap-3">
                        <strong className="text-sm">字段覆盖</strong>
                        <div className="tm-inventory__binding-grid">
                          {selectedTemplateOption.fields.map((field) => (
                            <div key={field.key} className="grid gap-2">
                              <Label htmlFor={`inventory-binding-${field.key}`}>
                                {field.label}
                              </Label>
                              <Input
                                id={`inventory-binding-${field.key}`}
                                value={bindingDraft.fieldOverrides[field.key] ?? ""}
                                disabled={!selectedMaterial || selectedMaterialArchived}
                                placeholder={`默认：${selectedMaterialFieldMap[field.key] ?? "空"}`}
                                onChange={(event) =>
                                  setBindingDraft((current) => ({
                                    ...current,
                                    fieldOverrides: {
                                      ...current.fieldOverrides,
                                      [field.key]: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => void saveBinding()}
                        disabled={
                          !selectedMaterial || !selectedTemplateOption || selectedMaterialArchived
                        }
                      >
                        <Save className="size-4" />
                        <span>{editingBindingId ? "保存关联" : "添加关联"}</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="tm-inventory-detail__rail">
                {selectedMaterial ? (
                  <>
                    <Card className="tm-panel">
                      <CardContent className="grid gap-2 pt-6">
                        <span className="text-sm text-muted-foreground">当前库存</span>
                        <strong className="tm-inventory-detail__quantity">
                          {selectedMaterial.currentQuantity}
                        </strong>
                        <span className="text-sm text-muted-foreground">
                          {selectedMaterial.packagingRemark || "无包装备注"}
                        </span>
                      </CardContent>
                    </Card>
                    <Card className="tm-panel">
                      <CardHeader className="pb-2">
                        <CardTitle as="h2">库存调整</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-4">
                        <div className="tm-inventory__form-grid">
                          <div className="grid gap-2">
                            <Label>动作</Label>
                            <Select
                              value={adjustmentKind}
                              disabled={selectedMaterialArchived}
                              onValueChange={(value: InventoryAdjustmentInput["kind"]) =>
                                setAdjustmentKind(value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="选择动作" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="in">入库</SelectItem>
                                <SelectItem value="out">出库</SelectItem>
                                <SelectItem value="correction">盘点校正</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="inventory-adjustment-value">
                              {adjustmentKind === "correction" ? "目标库存" : "数量"}
                            </Label>
                            <Input
                              id="inventory-adjustment-value"
                              inputMode="numeric"
                              value={adjustmentValue}
                              disabled={selectedMaterialArchived}
                              onChange={(event) => setAdjustmentValue(event.target.value)}
                            />
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="inventory-adjustment-note">备注</Label>
                          <Textarea
                            id="inventory-adjustment-note"
                            rows={2}
                            value={adjustmentNote}
                            disabled={selectedMaterialArchived}
                            onChange={(event) => setAdjustmentNote(event.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          onClick={() => void submitAdjustment()}
                          disabled={selectedMaterialArchived}
                        >
                          <Save className="size-4" />
                          <span>提交库存调整</span>
                        </Button>
                      </CardContent>
                    </Card>
                    <Card className="tm-panel">
                      <CardHeader className="pb-2">
                        <CardTitle as="h2">手动打印标签</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-4">
                        {selectedMaterial.labelBindings.length === 0 ? (
                          <EmptyMini text="先在当前物料里关联至少一个标签模板。" />
                        ) : (
                          <>
                            <div className="grid gap-2">
                              <Label>模板</Label>
                              <Select
                                value={selectedPrintBinding?.id ?? ""}
                                disabled={selectedMaterialArchived}
                                onValueChange={setPrintBindingId}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="选择要打印的关联模板" />
                                </SelectTrigger>
                                <SelectContent>
                                  {selectedMaterial.labelBindings.map((binding) => (
                                    <SelectItem key={binding.id} value={binding.id}>
                                      {binding.templateName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="inventory-print-quantity">本次打印数量</Label>
                              <Input
                                id="inventory-print-quantity"
                                inputMode="numeric"
                                value={printQuantity}
                                disabled={selectedMaterialArchived}
                                onChange={(event) => setPrintQuantity(event.target.value)}
                              />
                            </div>
                            <Button
                              type="button"
                              onClick={() => void printSelectedBinding()}
                              disabled={selectedMaterialArchived}
                            >
                              <Printer className="size-4" />
                              <span>打印当前标签</span>
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                    <PreviewCard controller={controller} emptyText="先打印当前标签后查看预览。" />
                    {!selectedMaterialArchived ? null : (
                      <Alert>
                        <AlertTitle>归档态已停用库存与打印</AlertTitle>
                        <AlertDescription>
                          如需继续操作，请先在当前详情页恢复该物料。
                        </AlertDescription>
                      </Alert>
                    )}
                    <Card className="tm-panel">
                      <CardHeader className="pb-2">
                        <CardTitle as="h2">最近流水</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-2">
                        {adjustments.length === 0 ? (
                          <EmptyMini text="当前物料还没有库存流水。" />
                        ) : (
                          adjustments.map((adjustment) => (
                            <div key={adjustment.id} className="tm-list-item">
                              <span>
                                <strong>
                                  {adjustment.kind === "in"
                                    ? `入库 +${adjustment.quantityDelta}`
                                    : adjustment.kind === "out"
                                      ? `出库 ${adjustment.quantityDelta}`
                                      : `盘点 -> ${adjustment.quantityAfter}`}
                                </strong>
                                <small className="block text-muted-foreground">
                                  {adjustment.note || "无备注"}
                                </small>
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {adjustment.createdAt}
                              </span>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card className="tm-panel">
                    <CardHeader className="pb-2">
                      <CardTitle as="h2">后续操作</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <EmptyMini
                        text={
                          loading
                            ? "正在读取库存物料…"
                            : isNewMaterialRoute
                              ? "先保存物料，再在这里做库存调整、打印和查看流水。"
                              : "当前物料不存在或尚未加载完成。"
                        }
                      />
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
