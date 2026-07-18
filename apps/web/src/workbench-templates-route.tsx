import {
  ChevronLeft,
  Copy,
  LayoutGrid,
  LayoutList,
  LayoutTemplate,
  Plus,
  Rows3,
  Trash2,
  Upload,
} from "lucide-react"
import React from "react"
import { parseUserTemplatePackage } from "../../../packages/core/src/web.js"

import { createDraftFromUserTemplatePackage } from "./canvas-editor-model.js"
import { ActionButton } from "./components/ui/action-button.js"
import { Input } from "./components/ui/input.js"
import { PromptDialog } from "./components/ui/dialog.js"
import { buildInputFromTemplate, defaultRenderOptions } from "./demo-data.js"
import { cn } from "./lib/utils.js"
import { ensureExtendedRuntimeFontStyles } from "./runtime-font-loader.js"
import type { CanvasDraftDocument, Template, UserTemplateSummary } from "./types.js"
import {
  loadWorkingCopy,
  readUserTemplateHistory,
  saveUserTemplate,
} from "./user-template-store.js"
import {
  createTemplatePrintSource,
  createUserTemplatePrintSource,
  EmptyMini,
  getTemplateColumnWidthRange,
  PaneHeader,
  resolveTemplateColumnLayout,
  TEMPLATE_PREVIEW_DEBOUNCE_MS,
  TEMPLATE_STACKED_PREVIEW_THRESHOLD,
  TemplateActionMenu,
  TemplateGroup,
  TemplatesPrintRail,
  toTemplateFieldList,
  useElementClientWidth,
  useMediaQuery,
  WIDE_TRIPLE_THRESHOLD,
} from "./workbench-app.js"
import { createInitialTemplateRows, type WorkbenchController } from "./workbench-controller.js"
import { useWorkbenchNavigate } from "./workbench-navigation.js"

type TemplateRow = {
  id: string
  values: Record<string, string>
}

type TemplateCardEntry =
  | {
      kind: "system"
      id: string
      template: Template
    }
  | {
      kind: "user"
      id: string
      template: UserTemplateSummary
      draft: CanvasDraftDocument | null
    }

type TemplateListMode = "large" | "list"
type TemplateNarrowStage = "list" | "table"
type TemplateActionKind = "edit" | "rename" | "archive"
type TemplateActionMenuState = {
  entry: TemplateCardEntry
  x: number
  y: number
}

function toSingleLineFieldValue(value: string): string {
  return value.replace(/\s+/g, " ").trimStart()
}

function useTemplatesRouteState(controller: WorkbenchController) {
  const [userTemplatePreviewDrafts, setUserTemplatePreviewDrafts] = React.useState<
    Record<string, CanvasDraftDocument | null>
  >({})
  const templateEntries = React.useMemo<TemplateCardEntry[]>(
    () => [
      ...controller.templates.map((template) => ({
        kind: "system" as const,
        id: `system:${template.id}`,
        template,
      })),
      ...controller.userTemplates.map((template) => ({
        kind: "user" as const,
        id: `user:${template.id}`,
        template,
        draft: userTemplatePreviewDrafts[template.id] ?? null,
      })),
    ],
    [controller.templates, controller.userTemplates, userTemplatePreviewDrafts]
  )
  const [templateEntryId, setTemplateEntryId] = React.useState(() => templateEntries[0]?.id ?? "")
  const activeTemplateEntry = React.useMemo(
    () => templateEntries.find((entry) => entry.id === templateEntryId) ?? null,
    [templateEntries, templateEntryId]
  )
  const activeTemplate = activeTemplateEntry?.template ?? null
  const [templateRows, setTemplateRows] = React.useState<TemplateRow[]>(() =>
    createInitialTemplateRows(controller.templates[0], 3)
  )
  const [activeUserTemplateDraft, setActiveUserTemplateDraft] =
    React.useState<CanvasDraftDocument | null>(null)
  const [activeUserTemplateDraftLoading, setActiveUserTemplateDraftLoading] = React.useState(false)
  const [selectedRowId, setSelectedRowId] = React.useState<string>("")
  const [editingTemplateCell, setEditingTemplateCell] = React.useState<{
    rowId: string
    fieldKey: string
  } | null>(null)
  const [templateNarrowStage, setTemplateNarrowStage] = React.useState<TemplateNarrowStage>("list")

  React.useEffect(() => {
    if (!activeTemplateEntry || !activeTemplate) {
      setTemplateRows([])
      setSelectedRowId("")
      return
    }

    const templateFields = toTemplateFieldList(activeTemplate)
    setTemplateRows((currentRows) => {
      if (currentRows.length > 0 && currentRows[0]?.id.startsWith(activeTemplate.id)) {
        const schemaMatchesCurrentRows =
          Object.keys(currentRows[0]?.values ?? {}).join("|") ===
          templateFields.map((field) => field.key).join("|")
        if (schemaMatchesCurrentRows) {
          return currentRows
        }
      }
      return createInitialTemplateRows(
        {
          id: activeTemplate.id,
          name: activeTemplate.name,
          description: activeTemplate.description,
          width: activeTemplate.width,
          height: activeTemplate.height,
          fields: templateFields,
        },
        3
      )
    })
  }, [activeTemplate, activeTemplateEntry])

  React.useEffect(() => {
    if (controller.userTemplates.length === 0) {
      setUserTemplatePreviewDrafts({})
      return
    }

    let cancelled = false
    void (async () => {
      const previews = await Promise.all(
        controller.userTemplates.map(async (template) => {
          const workingCopy = await loadWorkingCopy({
            kind: "user-template",
            templateId: template.id,
          })
          if (workingCopy?.draft) {
            return [template.id, workingCopy.draft] as const
          }
          const history = await readUserTemplateHistory(template.id)
          const version =
            history?.saved.find((item) => item.id === history.template.currentVersionId) ??
            history?.saved[0] ??
            null
          return [template.id, version?.document ?? null] as const
        })
      )

      if (!cancelled) {
        setUserTemplatePreviewDrafts(Object.fromEntries(previews))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [controller.userTemplates])

  React.useEffect(() => {
    if (activeTemplateEntry?.kind !== "user") {
      setActiveUserTemplateDraft(null)
      setActiveUserTemplateDraftLoading(false)
      controller.setRenderOptions(defaultRenderOptions)
      return
    }

    let cancelled = false
    const templateId = activeTemplateEntry.template.id
    setActiveUserTemplateDraft(null)
    setActiveUserTemplateDraftLoading(true)
    void (async () => {
      try {
        const workingCopy = await loadWorkingCopy({
          kind: "user-template",
          templateId,
        })
        const version = workingCopy?.draft ?? null
        if (!cancelled) {
          if (version) {
            setActiveUserTemplateDraft(version)
            controller.setRenderOptions({
              ...defaultRenderOptions,
              ...version.renderOptions,
            })
            return
          }
          const history = await readUserTemplateHistory(templateId)
          const savedVersion =
            history?.saved.find((item) => item.id === history.template.currentVersionId) ??
            history?.saved[0] ??
            null
          if (!cancelled) {
            const draft = savedVersion?.document ?? null
            setActiveUserTemplateDraft(draft)
            controller.setRenderOptions({
              ...defaultRenderOptions,
              ...draft?.renderOptions,
            })
          }
        }
      } finally {
        if (!cancelled) {
          setActiveUserTemplateDraftLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeTemplateEntry, controller])

  React.useEffect(() => {
    if (!templateRows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(templateRows[0]?.id ?? "")
    }
  }, [selectedRowId, templateRows])

  React.useEffect(() => {
    if (!editingTemplateCell) {
      return
    }
    const row = templateRows.find((item) => item.id === editingTemplateCell.rowId)
    const hasField =
      (activeTemplateEntry?.kind === "user"
        ? activeTemplateEntry.template.fields
        : activeTemplate?.fields
      )?.some((field) => field.key === editingTemplateCell.fieldKey) ?? false
    if (!row || !hasField) {
      setEditingTemplateCell(null)
    }
  }, [activeTemplate, activeTemplateEntry, editingTemplateCell, templateRows])

  const selectedTemplateRow = React.useMemo(
    () => templateRows.find((row) => row.id === selectedRowId) ?? templateRows[0] ?? null,
    [selectedRowId, templateRows]
  )
  const lastAutoPreviewKeyRef = React.useRef<string | null>(null)
  const autoPreviewInFlightKeyRef = React.useRef<string | null>(null)
  const templateAutoPreviewTimerRef = React.useRef<number | null>(null)

  const clearTemplateAutoPreviewTimer = React.useCallback(() => {
    if (templateAutoPreviewTimerRef.current === null) {
      return
    }
    window.clearTimeout(templateAutoPreviewTimerRef.current)
    templateAutoPreviewTimerRef.current = null
  }, [])

  React.useEffect(() => {
    lastAutoPreviewKeyRef.current = null
    autoPreviewInFlightKeyRef.current = null
    clearTemplateAutoPreviewTimer()
  }, [clearTemplateAutoPreviewTimer])

  React.useEffect(() => clearTemplateAutoPreviewTimer, [clearTemplateAutoPreviewTimer])

  const addTemplateRow = React.useCallback(() => {
    if (!activeTemplate) {
      return
    }
    const fields = toTemplateFieldList(activeTemplate)
    const row: TemplateRow = {
      id: `${activeTemplate.id}-${crypto.randomUUID()}`,
      values: buildInputFromTemplate({
        id: activeTemplate.id,
        name: activeTemplate.name,
        description: activeTemplate.description,
        width: activeTemplate.width,
        height: activeTemplate.height,
        fields,
      }),
    }
    setTemplateRows((currentRows) => [...currentRows, row])
    setSelectedRowId(row.id)
    setEditingTemplateCell(fields[0] ? { rowId: row.id, fieldKey: fields[0].key } : null)
    setTemplateNarrowStage("table")
  }, [activeTemplate])

  const duplicateTemplateRow = React.useCallback(() => {
    if (!selectedTemplateRow) {
      return
    }
    const row: TemplateRow = {
      id: `${selectedTemplateRow.id}-copy-${crypto.randomUUID()}`,
      values: { ...selectedTemplateRow.values },
    }
    setTemplateRows((currentRows) => {
      const index = currentRows.findIndex((item) => item.id === selectedTemplateRow.id)
      if (index < 0) {
        return [...currentRows, row]
      }
      const next = [...currentRows]
      next.splice(index + 1, 0, row)
      return next
    })
    setSelectedRowId(row.id)
    const fields =
      activeTemplateEntry?.kind === "user"
        ? activeTemplateEntry.template.fields
        : activeTemplate?.fields
    setEditingTemplateCell(fields?.[0] ? { rowId: row.id, fieldKey: fields[0].key } : null)
    setTemplateNarrowStage("table")
  }, [activeTemplate, activeTemplateEntry, selectedTemplateRow])

  const deleteTemplateRow = React.useCallback(() => {
    if (!selectedTemplateRow) {
      return
    }
    setTemplateRows((currentRows) => currentRows.filter((row) => row.id !== selectedTemplateRow.id))
    setEditingTemplateCell(null)
    setTemplateNarrowStage("table")
  }, [selectedTemplateRow])

  const previewTemplateRow = React.useCallback(
    async (row: TemplateRow) => {
      if (!activeTemplate) {
        controller.setError("先选择模板与一行数据。")
        return
      }
      const userTemplateDraftReady =
        activeTemplateEntry?.kind !== "user" ||
        (activeUserTemplateDraft?.templateId === activeTemplateEntry.template.id &&
          !activeUserTemplateDraftLoading)
      if (!userTemplateDraftReady) {
        controller.setError("正在读取本地模板草稿，请稍后再预览。")
        return
      }

      const source =
        activeTemplateEntry?.kind === "user" && activeUserTemplateDraft
          ? createUserTemplatePrintSource(
              activeTemplateEntry.template,
              activeUserTemplateDraft,
              row,
              controller.renderOptions
            )
          : createTemplatePrintSource(activeTemplate as Template, row, controller.renderOptions)
      const previewKey = JSON.stringify(source)
      const result = await controller.previewSource(source)

      if (result !== undefined) {
        lastAutoPreviewKeyRef.current = previewKey
      }
    },
    [
      activeTemplate,
      activeTemplateEntry,
      activeUserTemplateDraft,
      activeUserTemplateDraftLoading,
      controller,
    ]
  )

  const autoPreviewTemplateRow = React.useCallback(
    async (row: TemplateRow) => {
      if (!activeTemplate) {
        return
      }
      const userTemplateDraftReady =
        activeTemplateEntry?.kind !== "user" ||
        (activeUserTemplateDraft?.templateId === activeTemplateEntry.template.id &&
          !activeUserTemplateDraftLoading)
      if (!userTemplateDraftReady) {
        return
      }
      clearTemplateAutoPreviewTimer()

      const source =
        activeTemplateEntry?.kind === "user" && activeUserTemplateDraft
          ? createUserTemplatePrintSource(
              activeTemplateEntry.template,
              activeUserTemplateDraft,
              row,
              controller.renderOptions
            )
          : createTemplatePrintSource(activeTemplate as Template, row, controller.renderOptions)
      const previewKey = JSON.stringify(source)
      if (
        lastAutoPreviewKeyRef.current === previewKey ||
        autoPreviewInFlightKeyRef.current === previewKey
      ) {
        return
      }

      autoPreviewInFlightKeyRef.current = previewKey
      try {
        await previewTemplateRow(row)
      } finally {
        if (autoPreviewInFlightKeyRef.current === previewKey) {
          autoPreviewInFlightKeyRef.current = null
        }
      }
    },
    [
      activeTemplate,
      activeTemplateEntry,
      activeUserTemplateDraft,
      activeUserTemplateDraftLoading,
      clearTemplateAutoPreviewTimer,
      controller.renderOptions,
      previewTemplateRow,
    ]
  )

  const updateTemplateField = React.useCallback(
    (rowId: string, fieldKey: string, value: string) => {
      const nextValue = toSingleLineFieldValue(value)
      const nextSelectedRow =
        selectedTemplateRow?.id === rowId
          ? {
              ...selectedTemplateRow,
              values: {
                ...selectedTemplateRow.values,
                [fieldKey]: nextValue,
              },
            }
          : null

      setTemplateRows((currentRows) =>
        currentRows.map((row) =>
          row.id === rowId
            ? {
                ...row,
                values: {
                  ...row.values,
                  [fieldKey]: nextValue,
                },
              }
            : row
        )
      )
      if (nextSelectedRow) {
        clearTemplateAutoPreviewTimer()
        templateAutoPreviewTimerRef.current = window.setTimeout(() => {
          templateAutoPreviewTimerRef.current = null
          void autoPreviewTemplateRow(nextSelectedRow)
        }, TEMPLATE_PREVIEW_DEBOUNCE_MS)
      }
      setTemplateNarrowStage("table")
    },
    [autoPreviewTemplateRow, clearTemplateAutoPreviewTimer, selectedTemplateRow]
  )

  const previewSelectedTemplateRow = React.useCallback(async () => {
    if (!selectedTemplateRow) {
      controller.setError("先选择模板与一行数据。")
      return
    }
    clearTemplateAutoPreviewTimer()
    await previewTemplateRow(selectedTemplateRow)
  }, [clearTemplateAutoPreviewTimer, controller, previewTemplateRow, selectedTemplateRow])

  const printSelectedTemplateRow = React.useCallback(async () => {
    if (!activeTemplate || !selectedTemplateRow) {
      controller.setError("先选择模板与一行数据。")
      return
    }
    const userTemplateDraftReady =
      activeTemplateEntry?.kind !== "user" ||
      (activeUserTemplateDraft?.templateId === activeTemplateEntry.template.id &&
        !activeUserTemplateDraftLoading)
    if (!userTemplateDraftReady) {
      controller.setError("正在读取本地模板草稿，请稍后再打印。")
      return
    }
    await controller.printSourceDirect(
      activeTemplateEntry?.kind === "user" && activeUserTemplateDraft
        ? createUserTemplatePrintSource(
            activeTemplateEntry.template,
            activeUserTemplateDraft,
            selectedTemplateRow,
            controller.renderOptions
          )
        : createTemplatePrintSource(
            activeTemplate as Template,
            selectedTemplateRow,
            controller.renderOptions
          )
    )
  }, [
    activeTemplate,
    activeTemplateEntry,
    activeUserTemplateDraft,
    activeUserTemplateDraftLoading,
    controller,
    selectedTemplateRow,
  ])

  const archiveTemplateEntry = React.useCallback(
    async (entryId: string) => {
      const entry = templateEntries.find((item) => item.id === entryId)
      if (entry?.kind !== "user") {
        return null
      }

      if (templateEntryId === entryId) {
        const visibleUserEntries = templateEntries.filter((item) => item.kind === "user")
        const currentIndex = visibleUserEntries.findIndex((item) => item.id === entryId)
        const fallbackEntry =
          visibleUserEntries[currentIndex + 1] ?? visibleUserEntries[currentIndex - 1] ?? null
        setTemplateEntryId(fallbackEntry?.id ?? "")
      }

      setTemplateNarrowStage("list")
      setEditingTemplateCell(null)
      return controller.archiveTemplate(entry.template.id)
    },
    [controller, templateEntries, templateEntryId]
  )

  return {
    activeTemplate,
    activeTemplateEntry,
    activeUserTemplateDraftLoading,
    addTemplateRow,
    archiveTemplateEntry,
    autoPreviewTemplateRow,
    deleteTemplateRow,
    duplicateTemplateRow,
    editingTemplateCell,
    previewSelectedTemplateRow,
    printSelectedTemplateRow,
    selectedRowId,
    selectedTemplateRow,
    setEditingTemplateCell,
    setSelectedRowId,
    setTemplateEntryId,
    setTemplateFocus: (_focus: "left-center" | "center-right") => undefined,
    setTemplateNarrowStage,
    templateEntries,
    templateNarrowStage,
    templateRows,
    updateTemplateField,
  }
}

export default function WorkbenchTemplatesRoute({
  controller,
  onPresentArchiveToast,
  onRouteChunkReady,
}: {
  controller: WorkbenchController
  onPresentArchiveToast?: (template: UserTemplateSummary) => void
  onRouteChunkReady?: () => void
}) {
  const navigate = useWorkbenchNavigate()
  const state = useTemplatesRouteState(controller)
  const isTriple = useMediaQuery(`(min-width: ${WIDE_TRIPLE_THRESHOLD}px)`)
  const stacksPreviewBelowTable = !useMediaQuery(
    `(min-width: ${TEMPLATE_STACKED_PREVIEW_THRESHOLD}px)`
  )
  const usesSingleOutletFlow = !isTriple
  const showsTableStage = state.templateNarrowStage === "table"
  const showsDisabledPreviewRail =
    usesSingleOutletFlow && state.templateNarrowStage === "list" && !stacksPreviewBelowTable
  const usesSplitTableAndPreview =
    usesSingleOutletFlow && showsTableStage && !stacksPreviewBelowTable
  const showsListOnlyPane =
    usesSingleOutletFlow && state.templateNarrowStage === "list" && stacksPreviewBelowTable
  const showTemplateListPane = !usesSingleOutletFlow || state.templateNarrowStage === "list"
  const showTemplateTablePane = !usesSingleOutletFlow || showsTableStage
  const showTemplatePreviewPane =
    !usesSingleOutletFlow || showsTableStage || showsDisabledPreviewRail
  const activeUserTemplatePending =
    state.activeTemplateEntry?.kind === "user" && state.activeUserTemplateDraftLoading
  const templatePreviewDisabled =
    showsDisabledPreviewRail ||
    !state.activeTemplateEntry ||
    !state.selectedTemplateRow ||
    activeUserTemplatePending
  const [listMode, setListMode] = React.useState<TemplateListMode>("large")
  const [actionMenu, setActionMenu] = React.useState<TemplateActionMenuState | null>(null)
  const [renameDialog, setRenameDialog] = React.useState<{
    templateId: string
    currentName: string
  } | null>(null)
  const importInputId = React.useId()
  const importInputRef = React.useRef<HTMLInputElement | null>(null)
  const [importStatus, setImportStatus] = React.useState("")
  const [tableShellElement, setTableShellElement] = React.useState<HTMLDivElement | null>(null)
  const tableShellWidth = useElementClientWidth(tableShellElement)
  const activeTemplateFields = state.activeTemplate ? toTemplateFieldList(state.activeTemplate) : []
  const systemEntries = React.useMemo(
    () => state.templateEntries.filter((entry) => entry.kind === "system"),
    [state.templateEntries]
  )
  const userEntries = React.useMemo(
    () => state.templateEntries.filter((entry) => entry.kind === "user"),
    [state.templateEntries]
  )
  const templateColumnLayout = React.useMemo(
    () => resolveTemplateColumnLayout(activeTemplateFields, state.templateRows, tableShellWidth),
    [activeTemplateFields, state.templateRows, tableShellWidth]
  )

  React.useEffect(() => {
    onRouteChunkReady?.()
    void ensureExtendedRuntimeFontStyles()
    void Promise.all([controller.refreshUserTemplates(), controller.refreshArchivedUserTemplates()])
  }, [controller, onRouteChunkReady])

  React.useEffect(() => {
    if (actionMenu && !state.templateEntries.some((entry) => entry.id === actionMenu.entry.id)) {
      setActionMenu(null)
    }
  }, [actionMenu, state.templateEntries])

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      if (
        target.closest(".tm-template-card") ||
        target.closest(".tm-template-action-menu") ||
        target.closest("[role='dialog']")
      ) {
        return
      }
      setActionMenu(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionMenu(null)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  const importTemplatePackage = React.useCallback(
    async (file: File) => {
      try {
        const templatePackage = parseUserTemplatePackage(JSON.parse(await file.text()))
        const draft = createDraftFromUserTemplatePackage(templatePackage)
        await saveUserTemplate({
          name: templatePackage.name,
          description: templatePackage.description,
          document: draft,
        })
        await Promise.all([
          controller.refreshUserTemplates(),
          controller.refreshArchivedUserTemplates(),
        ])
        setImportStatus(`已导入 ${templatePackage.name}`)
      } catch (error) {
        setImportStatus(error instanceof Error ? `导入失败：${error.message}` : "导入失败。")
      } finally {
        if (importInputRef.current) {
          importInputRef.current.value = ""
        }
      }
    },
    [controller]
  )

  const editTemplateEntry = React.useCallback(
    (entryId: string) => {
      const entry = state.templateEntries.find((item) => item.id === entryId)
      if (!entry) {
        return
      }
      navigate(
        entry.kind === "system"
          ? `/canvas?source=preset-template&templateId=${entry.template.id}`
          : `/canvas?source=user-template&templateId=${entry.template.id}`
      )
    },
    [navigate, state.templateEntries]
  )

  const archiveTemplateEntry = React.useCallback(
    async (entryId: string) => {
      const archived = await state.archiveTemplateEntry(entryId)
      if (!archived) {
        return
      }
      setActionMenu(null)
      onPresentArchiveToast?.(archived)
    },
    [onPresentArchiveToast, state]
  )

  const openRenameTemplateDialog = React.useCallback((entry: TemplateCardEntry) => {
    if (entry.kind !== "user") {
      return
    }
    setActionMenu(null)
    setRenameDialog({
      templateId: entry.template.id,
      currentName: entry.template.name,
    })
  }, [])

  const handleTemplateAction = React.useCallback(
    async (entry: TemplateCardEntry, action: TemplateActionKind) => {
      if (action === "edit") {
        editTemplateEntry(entry.id)
        setActionMenu(null)
        return
      }
      if (action === "rename") {
        openRenameTemplateDialog(entry)
        return
      }
      await archiveTemplateEntry(entry.id)
    },
    [archiveTemplateEntry, editTemplateEntry, openRenameTemplateDialog]
  )

  const handleTemplateSelect = React.useCallback(
    (entryId: string) => {
      state.setTemplateEntryId(entryId)
      if (usesSingleOutletFlow) {
        state.setTemplateNarrowStage("table")
      }
    },
    [state, usesSingleOutletFlow]
  )

  const openTemplateActionMenu = React.useCallback(
    (entry: TemplateCardEntry, position: { x: number; y: number }) => {
      state.setTemplateEntryId(entry.id)
      setActionMenu({
        entry,
        x: position.x,
        y: position.y,
      })
    },
    [state]
  )

  const handleTemplateContextMenu = React.useCallback(
    (entry: TemplateCardEntry, event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      openTemplateActionMenu(entry, { x: event.clientX, y: event.clientY })
    },
    [openTemplateActionMenu]
  )

  return (
    <section className="tm-workspace">
      <div
        className={cn(
          "tm-pane-grid",
          "tm-pane-grid--template",
          showsListOnlyPane && "tm-pane-grid--single-pane",
          showsDisabledPreviewRail && "tm-pane-grid--preview-side",
          usesSplitTableAndPreview && "tm-pane-grid--focus-right",
          isTriple && "tm-pane-grid--triple",
          stacksPreviewBelowTable && "tm-pane-grid--stacked-preview"
        )}
      >
        {showTemplateListPane ? (
          <aside className="tm-pane tm-pane--left">
            <PaneHeader
              icon={LayoutTemplate}
              title="模板列表"
              actions={
                <div className="tm-template-list__header-actions">
                  <ActionButton
                    type="button"
                    name={listMode === "large" ? "大图" : "列表"}
                    icon={listMode === "large" ? LayoutGrid : LayoutList}
                    mode="icon-text"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setListMode((currentMode) => (currentMode === "large" ? "list" : "large"))
                    }
                  />
                </div>
              }
            />
            <div className="tm-template-list__primary-actions">
              <input
                ref={importInputRef}
                id={importInputId}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="选择模板包文件"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (file) {
                    void importTemplatePackage(file)
                  }
                }}
              />
              <ActionButton
                type="button"
                name="导入模板"
                icon={Upload}
                mode="icon-text"
                size="sm"
                variant="outline"
                onClick={() => importInputRef.current?.click()}
              />
              <ActionButton
                type="button"
                name="新增模板"
                icon={Plus}
                mode="icon-text"
                size="sm"
                variant="outline"
                onClick={() => navigate("/canvas")}
              />
            </div>
            <div
              className={cn(
                "tm-pane__body",
                "tm-template-list",
                listMode === "large" ? "tm-template-list--large" : "tm-template-list--list"
              )}
            >
              <TemplateGroup
                title="系统模板"
                entries={systemEntries}
                listMode={listMode}
                activeEntryId={state.activeTemplateEntry?.id ?? ""}
                onSelect={handleTemplateSelect}
                onContextMenu={handleTemplateContextMenu}
                onOpenMenu={openTemplateActionMenu}
              />
              <TemplateGroup
                title="我的模板"
                entries={userEntries}
                listMode={listMode}
                activeEntryId={state.activeTemplateEntry?.id ?? ""}
                emptyText="还没有保存到浏览器本地的用户模板。"
                emptyAction={
                  <ActionButton
                    type="button"
                    name="新增模板"
                    icon={Plus}
                    mode="icon-text"
                    size="sm"
                    variant="outline"
                    className="tm-template-list__empty-action-button"
                    onClick={() => navigate("/canvas")}
                  />
                }
                onSelect={handleTemplateSelect}
                onContextMenu={handleTemplateContextMenu}
                onOpenMenu={openTemplateActionMenu}
              />
              {importStatus ? (
                <div className="tm-template-list__status" role="status">
                  {importStatus}
                </div>
              ) : null}
            </div>
            <TemplateActionMenu state={actionMenu} onAction={handleTemplateAction} />
            <PromptDialog
              open={renameDialog !== null}
              title="重命名模板"
              description="更新模板名称，不影响现有版本历史与归档状态。"
              label="模板名称"
              defaultValue={renameDialog?.currentName ?? ""}
              confirmLabel="保存"
              requiredMessage="请输入模板名称。"
              onOpenChange={(open) => {
                if (!open) {
                  setRenameDialog(null)
                }
              }}
              onConfirm={(value) => {
                if (!renameDialog) {
                  return
                }
                if (value === renameDialog.currentName) {
                  return
                }
                void controller.renameTemplate(renameDialog.templateId, value)
              }}
            />
          </aside>
        ) : null}

        {showTemplateTablePane ? (
          <section className="tm-pane tm-pane--center">
            <PaneHeader
              icon={Rows3}
              title="批量录入表"
              actions={
                <div className="flex flex-wrap gap-2">
                  {usesSingleOutletFlow ? (
                    <ActionButton
                      type="button"
                      name="返回模板"
                      icon={ChevronLeft}
                      mode="icon-text"
                      variant="outline"
                      size="sm"
                      onClick={() => state.setTemplateNarrowStage("list")}
                    />
                  ) : null}
                  <ActionButton
                    type="button"
                    name="新增行"
                    icon={Plus}
                    mode="icon-text"
                    variant="outline"
                    size="sm"
                    onClick={state.addTemplateRow}
                  />
                  <ActionButton
                    type="button"
                    name="复制行"
                    icon={Copy}
                    mode="icon-text"
                    variant="outline"
                    size="sm"
                    onClick={state.duplicateTemplateRow}
                  />
                  <ActionButton
                    type="button"
                    name="删除行"
                    icon={Trash2}
                    mode="icon-text"
                    variant="outline"
                    size="sm"
                    onClick={state.deleteTemplateRow}
                  />
                </div>
              }
            />
            <div className="tm-pane__body tm-pane__body--table">
              <div className="tm-table-shell" ref={setTableShellElement}>
                <table
                  className="tm-table"
                  style={{ width: `${templateColumnLayout.tableWidth}px` }}
                >
                  <colgroup>
                    <col style={{ width: "44px" }} />
                    {activeTemplateFields.map((field) => (
                      <col
                        key={field.key}
                        style={{
                          width: `${templateColumnLayout.columnWidths[field.key] ?? getTemplateColumnWidthRange(field).minWidth}px`,
                        }}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>
                        <span className="tm-table__header-label">行</span>
                      </th>
                      {activeTemplateFields.map((field) => (
                        <th key={field.key}>
                          <span className="tm-table__header-label">{field.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.templateRows.length === 0 ? (
                      <tr>
                        <td colSpan={activeTemplateFields.length + 1}>
                          <EmptyMini text="当前模板还没有数据行。" />
                        </td>
                      </tr>
                    ) : (
                      state.templateRows.map((row, rowIndex) => (
                        <tr
                          key={row.id}
                          className={cn(row.id === state.selectedRowId && "tm-table__row--active")}
                          onClick={() => {
                            state.setSelectedRowId(row.id)
                            state.setTemplateNarrowStage("table")
                            void state.autoPreviewTemplateRow(row)
                          }}
                        >
                          <td>
                            <span className="tm-table__row-index">{rowIndex + 1}</span>
                          </td>
                          {activeTemplateFields.map((field) => {
                            const value = toSingleLineFieldValue(row.values[field.key] ?? "")
                            const isEditing =
                              state.editingTemplateCell?.rowId === row.id &&
                              state.editingTemplateCell?.fieldKey === field.key
                            const columnWidth =
                              templateColumnLayout.columnWidths[field.key] ??
                              getTemplateColumnWidthRange(field).minWidth
                            const columnStyle = {
                              width: `${columnWidth}px`,
                              minWidth: `${columnWidth}px`,
                              maxWidth: `${columnWidth}px`,
                            } satisfies React.CSSProperties

                            return (
                              <td key={field.key}>
                                {isEditing ? (
                                  <Input
                                    value={value}
                                    className="tm-table__input tm-table__input--editing"
                                    density="compact"
                                    size="xs"
                                    style={columnStyle}
                                    autoFocus
                                    onFocus={() => {
                                      state.setSelectedRowId(row.id)
                                      state.setTemplateNarrowStage("table")
                                      void state.autoPreviewTemplateRow(row)
                                    }}
                                    onBlur={() => {
                                      state.setEditingTemplateCell(null)
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === "Escape") {
                                        event.currentTarget.blur()
                                      }
                                    }}
                                    onChange={(event) => {
                                      state.updateTemplateField(
                                        row.id,
                                        field.key,
                                        event.currentTarget.value
                                      )
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className="tm-table__cell"
                                    style={columnStyle}
                                    onFocus={() => {
                                      state.setSelectedRowId(row.id)
                                      state.setTemplateNarrowStage("table")
                                      void state.autoPreviewTemplateRow(row)
                                    }}
                                    onClick={() => {
                                      state.setSelectedRowId(row.id)
                                      state.setEditingTemplateCell({
                                        rowId: row.id,
                                        fieldKey: field.key,
                                      })
                                      state.setTemplateNarrowStage("table")
                                    }}
                                  >
                                    {value || "—"}
                                  </button>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {showTemplatePreviewPane ? (
          <aside className="tm-pane tm-pane--right">
            <TemplatesPrintRail
              controller={controller}
              state={state}
              disabled={templatePreviewDisabled}
              unavailableMessage={
                activeUserTemplatePending
                  ? "正在读取本地模板草稿。"
                  : "先选择模板后查看预览与打印。"
              }
              onFocusRight={() => state.setTemplateFocus("center-right")}
            />
          </aside>
        ) : null}
      </div>
    </section>
  )
}
