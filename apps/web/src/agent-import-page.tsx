import type {
  AgentImportItem,
  AgentImportSession,
  AgentImportTemplate,
  InventoryMaterial,
} from "@tuckmark/inventory"
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  LoaderCircle,
  PackagePlus,
  Save,
  Warehouse,
} from "lucide-react"
import React from "react"
import { buildSvg, getTemplateById } from "../../../packages/core/src/web.js"

import { type AgentImportClient, HttpAgentImportClient } from "./agent-import-client.js"
import {
  type AgentImportItemDraft,
  isCurrentAgentImportSession,
  reconcileAgentImportDrafts,
} from "./agent-import-draft-reconciliation.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Input } from "./components/ui/input.js"
import { Label } from "./components/ui/label.js"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js"
import { cn } from "./lib/utils.js"

type ItemDraft = AgentImportItemDraft

type AgentImportPageProps = {
  sessionId?: string
  secret?: string
  client?: AgentImportClient
  initialSession?: AgentImportSession
}

const defaultAgentImportClient = new HttpAgentImportClient()

function templateKey(template: AgentImportTemplate): string {
  return `${template.source}:${template.id}`
}

function resolveItemTemplates(item: AgentImportItem): AgentImportTemplate[] {
  const values = [...(item.template ? [item.template] : []), ...item.templateAlternatives]
  return values.filter(
    (template, index) =>
      values.findIndex((candidate) => templateKey(candidate) === templateKey(template)) === index
  )
}

function renderSystemTemplatePreview(
  template: AgentImportTemplate,
  input: Record<string, string>
): string | null {
  if (template.source !== "system") {
    return null
  }
  try {
    const definition = getTemplateById(template.id)
    return buildSvg(definition.width, definition.height, definition.elements, input)
  } catch {
    return null
  }
}

function sessionIdFromLocation(): string | undefined {
  if (typeof window === "undefined") {
    return undefined
  }
  const match = window.location.pathname.match(/\/agent-import\/([^/]+)/u)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function secretFromLocation(): string | undefined {
  if (typeof window === "undefined") {
    return undefined
  }
  return new URLSearchParams(window.location.hash.replace(/^#/u, "")).get("key") ?? undefined
}

function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt)
  return Number.isNaN(date.valueOf())
    ? "会话即将过期"
    : `有效至 ${date.toLocaleString("zh-CN", { hour12: false })}`
}

export function AgentImportPage({
  sessionId = sessionIdFromLocation(),
  secret = secretFromLocation(),
  client = defaultAgentImportClient,
  initialSession,
}: AgentImportPageProps) {
  const [session, setSession] = React.useState<AgentImportSession | null>(initialSession ?? null)
  const [drafts, setDrafts] = React.useState<Record<string, ItemDraft>>(() =>
    initialSession ? reconcileAgentImportDrafts({}, initialSession) : {}
  )
  const [restockTargets, setRestockTargets] = React.useState<Record<string, InventoryMaterial>>({})
  const [expandedItemIds, setExpandedItemIds] = React.useState<Set<string>>(() => new Set())
  const [loading, setLoading] = React.useState(!initialSession)
  const [savingItemId, setSavingItemId] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const latestSessionRef = React.useRef<AgentImportSession | null>(initialSession ?? null)

  const applySession = React.useCallback((next: AgentImportSession) => {
    const current = latestSessionRef.current
    if (current && !isCurrentAgentImportSession(next, current)) {
      return false
    }
    latestSessionRef.current = next
    setSession(next)
    setDrafts((current) => reconcileAgentImportDrafts(current, next))
    return true
  }, [])

  const loadSession = React.useCallback(async () => {
    if (!sessionId || !secret) {
      setError("确认链接不完整或已失效。请回到创建该会话的 Agent 重新打开确认页。")
      setLoading(false)
      return
    }
    try {
      const next = await client.getSession(sessionId, secret)
      applySession(next)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取导入会话。")
    } finally {
      setLoading(false)
    }
  }, [applySession, client, secret, sessionId])

  React.useEffect(() => {
    if (initialSession) {
      return
    }
    void loadSession()
  }, [initialSession, loadSession])

  React.useEffect(() => {
    const targetSessionId = sessionId ?? session?.id
    if (!targetSessionId || !session) {
      setRestockTargets({})
      return
    }
    let cancelled = false
    void client
      .getRestockTargets(targetSessionId, secret ?? "")
      .then((targets) => {
        if (!cancelled) {
          setRestockTargets(
            Object.fromEntries(targets.map((target) => [target.itemId, target.material]))
          )
        }
      })
      .catch((targetError) => {
        if (!cancelled) {
          setRestockTargets({})
          setError(
            targetError instanceof Error ? targetError.message : "无法解析 DEVD 中的目标物料。"
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, secret, session, sessionId])

  React.useEffect(() => {
    if (!sessionId || !secret || !session || session.state !== "open") {
      return
    }
    const interval = window.setInterval(() => {
      void client
        .getSession(sessionId, secret)
        .then((next) => {
          if (applySession(next)) {
            setError(null)
          }
        })
        .catch((pollError) => {
          setError(pollError instanceof Error ? pollError.message : "无法刷新导入会话。")
        })
    }, 1_500)
    return () => window.clearInterval(interval)
  }, [applySession, client, secret, session, sessionId])

  const saveItem = React.useCallback(
    async (itemId: string) => {
      const draft = drafts[itemId]
      if (!draft || !sessionId) {
        return
      }
      setSavingItemId(itemId)
      try {
        const next = await client.updateItem({
          sessionId,
          secret: secret ?? "",
          itemId,
          expectedRevision: draft.serverRevision,
          item: draft.item,
        })
        applySession(next)
        setError(null)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "保存导入内容失败。")
      } finally {
        setSavingItemId(null)
      }
    },
    [applySession, client, drafts, secret, sessionId]
  )

  const updateDraft = React.useCallback(
    (itemId: string, update: (item: AgentImportItem) => AgentImportItem) => {
      setDrafts((current) => {
        const draft = current[itemId]
        if (!draft) {
          return current
        }
        return { ...current, [itemId]: { ...draft, item: update(draft.item) } }
      })
    },
    []
  )

  const toggleItemDetails = React.useCallback((itemId: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  const requestTemplate = React.useCallback(
    async (itemId: string, template: AgentImportTemplate) => {
      const draft = drafts[itemId]
      if (!draft || !sessionId) {
        return
      }
      setSavingItemId(itemId)
      try {
        const saved = await client.updateItem({
          sessionId,
          secret: secret ?? "",
          itemId,
          expectedRevision: draft.serverRevision,
          item: draft.item,
        })
        const savedItem = saved.proposal.items.find((item) => item.id === itemId)
        if (!savedItem) {
          throw new Error("导入项在保存后不存在。")
        }
        applySession(saved)
        const next = await client.requestTemplateInput({
          sessionId,
          secret: secret ?? "",
          itemId,
          expectedRevision: savedItem.revision,
          template,
        })
        applySession(next)
        setError(null)
      } catch (templateError) {
        setError(templateError instanceof Error ? templateError.message : "无法请求模板字段补全。")
      } finally {
        setSavingItemId(null)
      }
    },
    [applySession, client, drafts, secret, sessionId]
  )

  const confirm = React.useCallback(async () => {
    if (!sessionId) {
      return
    }
    setConfirming(true)
    try {
      for (const draft of Object.values(drafts)) {
        applySession(
          await client.updateItem({
            sessionId,
            secret: secret ?? "",
            itemId: draft.item.id,
            expectedRevision: draft.serverRevision,
            item: draft.item,
          })
        )
      }
      applySession(await client.confirm(sessionId, secret ?? ""))
      setError(null)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "确认导入失败。")
    } finally {
      setConfirming(false)
    }
  }, [applySession, client, drafts, secret, sessionId])

  if (loading) {
    return <AgentImportLoading />
  }

  if (!session) {
    return <AgentImportUnavailable message={error ?? "导入会话不可用。"} />
  }

  const newItems = session.proposal.items.filter((item) => item.kind === "new")
  const restockItems = session.proposal.items.filter((item) => item.kind === "restock")
  const pendingTemplateInput = session.proposal.items.some(
    (item) => item.selected && item.pendingTemplateEventId
  )
  const isCompleted = session.state === "completed"
  const hasUnresolvedRestockTarget = restockItems.some(
    (item) => drafts[item.id]?.item.selected && !restockTargets[item.id]
  )

  return (
    <main className="tm-agent-import" aria-live="polite">
      <header className="tm-agent-import__header">
        <div>
          <p className="tm-agent-import__eyebrow">受管入库会话</p>
          <h1>确认订单入库</h1>
          <p>编辑后选择要写入本地目录的物料。物料识别提示仅供注意，不会阻断确认。</p>
        </div>
        <div className="tm-agent-import__session-meta">
          <span>
            <Clock3 className="size-4" />
            {formatExpiry(session.expiresAt)}
          </span>
          <Badge variant={isCompleted ? "secondary" : "outline"}>
            {isCompleted ? "已导入" : "待确认"}
          </Badge>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="tm-agent-import__alert">
          <AlertTriangle className="mt-0.5 size-4" />
          <AlertTitle>会话操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {isCompleted ? (
        <Alert className="tm-agent-import__alert">
          <CheckCircle2 className="mt-0.5 size-4 text-emerald-700" />
          <AlertTitle>已写入库存目录</AlertTitle>
          <AlertDescription>此会话会在到期后自动移除。</AlertDescription>
        </Alert>
      ) : null}

      <ImportSection
        icon={<PackagePlus className="size-8" />}
        title="新增物品"
        description="创建物料、绑定一个标签模板，并写入入库流水。"
        count={newItems.length}
        kind="new"
        emptyText="该会话没有新增物品。"
      >
        {newItems.map((item) => {
          const draft = drafts[item.id]
          return draft ? (
            <AgentImportTableRow
              key={item.id}
              draft={draft}
              disabled={isCompleted}
              expanded={expandedItemIds.has(item.id)}
              saving={savingItemId === item.id}
              onChange={(update) => updateDraft(item.id, update)}
              onSave={() => void saveItem(item.id)}
              onToggleDetails={() => toggleItemDetails(item.id)}
              onRequestTemplate={(template) => void requestTemplate(item.id, template)}
            />
          ) : null
        })}
      </ImportSection>

      <ImportSection
        icon={<Warehouse className="size-8" />}
        title="增加库存"
        description="仅向 Agent 指定的已有物料写入入库流水，保留原有标签绑定。"
        count={restockItems.length}
        kind="restock"
        emptyText="该会话没有增加库存项。"
      >
        {restockItems.map((item) => {
          const draft = drafts[item.id]
          return draft ? (
            <AgentImportTableRow
              key={item.id}
              draft={draft}
              disabled={isCompleted}
              restockTarget={restockTargets[item.id]}
              expanded={false}
              saving={savingItemId === item.id}
              onChange={(update) => updateDraft(item.id, update)}
              onSave={() => void saveItem(item.id)}
              onToggleDetails={() => undefined}
              onRequestTemplate={() => undefined}
            />
          ) : null
        })}
      </ImportSection>

      <footer className="tm-agent-import__footer">
        {pendingTemplateInput ? (
          <span className="tm-agent-import__waiting">
            <LoaderCircle className="size-4 animate-spin" />
            正在等待 Agent 补全已切换模板的字段。
          </span>
        ) : (
          <span>所有选择内容会以当前编辑值写入。</span>
        )}
        <Button
          type="button"
          size="lg"
          onClick={() => void confirm()}
          disabled={
            isCompleted ||
            confirming ||
            Boolean(savingItemId) ||
            pendingTemplateInput ||
            hasUnresolvedRestockTarget
          }
        >
          {confirming ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {isCompleted ? "已完成导入" : "确认导入选中项"}
        </Button>
      </footer>
    </main>
  )
}

function ImportSection({
  icon,
  title,
  description,
  count,
  kind,
  emptyText,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  count: number
  kind: AgentImportItem["kind"]
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <section className="tm-agent-import__section">
      <header className="tm-agent-import__section-header">
        <div className="tm-agent-import__section-title">
          <span>{icon}</span>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <Badge variant="outline">{count} 项</Badge>
      </header>
      {count ? (
        <div className="tm-agent-import__table-shell">
          <table
            className={cn("tm-agent-import__table", `tm-agent-import__table--${kind}`)}
            aria-label={title}
          >
            <thead>
              <tr>
                <th className="tm-agent-import__column--select" scope="col">
                  导入
                </th>
                {kind === "new" ? (
                  <>
                    <th className="tm-agent-import__column--full-name" scope="col">
                      物料
                    </th>
                    <th className="tm-agent-import__column--base-name" scope="col">
                      基础型号
                    </th>
                    <th className="tm-agent-import__column--variant" scope="col">
                      变体
                    </th>
                    <th className="tm-agent-import__column--package" scope="col">
                      封装
                    </th>
                    <th className="tm-agent-import__column--quantity" scope="col">
                      数量
                    </th>
                    <th className="tm-agent-import__column--label-quantity" scope="col">
                      标签数
                    </th>
                    <th className="tm-agent-import__column--source" scope="col">
                      来源
                    </th>
                    <th className="tm-agent-import__column--datasheet" scope="col">
                      数据手册
                    </th>
                    <th className="tm-agent-import__column--template" scope="col">
                      标签模板
                    </th>
                  </>
                ) : (
                  <>
                    <th className="tm-agent-import__column--target" scope="col">
                      物料
                    </th>
                    <th className="tm-agent-import__column--target-id" scope="col">
                      物料 ID
                    </th>
                    <th className="tm-agent-import__column--model" scope="col">
                      型号
                    </th>
                    <th className="tm-agent-import__column--package" scope="col">
                      封装
                    </th>
                    <th className="tm-agent-import__column--quantity" scope="col">
                      入库数量
                    </th>
                    <th className="tm-agent-import__column--source" scope="col">
                      来源备注
                    </th>
                  </>
                )}
                <th className="tm-agent-import__column--attention" scope="col">
                  注意
                </th>
                <th className="tm-agent-import__column--action" scope="col">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : (
        <EmptySection text={emptyText} />
      )}
    </section>
  )
}

type AgentImportTableRowProps = {
  draft: ItemDraft
  disabled: boolean
  restockTarget?: InventoryMaterial
  expanded: boolean
  saving: boolean
  onChange: (update: (item: AgentImportItem) => AgentImportItem) => void
  onSave: () => void
  onToggleDetails: () => void
  onRequestTemplate: (template: AgentImportTemplate) => void
}

function AgentImportTableRow(props: AgentImportTableRowProps) {
  return props.draft.item.kind === "new" ? (
    <NewItemTableRow {...props} />
  ) : (
    <RestockItemTableRow {...props} />
  )
}

type InlineEditableCellProps = {
  label: string
  value: string
  disabled?: boolean
  type?: React.HTMLInputTypeAttribute
  min?: number
  onChange: (value: string) => void
}

function InlineEditableCell({
  label,
  value,
  disabled = false,
  type = "text",
  min,
  onChange,
}: InlineEditableCellProps) {
  const [editing, setEditing] = React.useState(false)
  const originalValue = React.useRef(value)

  React.useEffect(() => {
    if (disabled) {
      setEditing(false)
    }
  }, [disabled])

  if (!editing) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="tm-agent-import__editable-cell"
              aria-label={`编辑${label}`}
              disabled={disabled}
              onClick={() => {
                originalValue.current = value
                setEditing(true)
              }}
            >
              <span>{value || "—"}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>编辑{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <Input
      autoFocus
      aria-label={label}
      className="w-full tm-agent-import__cell-editor"
      density="compact"
      size="lg"
      type={type}
      min={min}
      value={value}
      disabled={disabled}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === "Escape") {
          event.preventDefault()
          onChange(originalValue.current)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

type InlineEditableSelectCellProps = {
  label: string
  value: string
  displayValue: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  onChange: (value: string) => void
}

function InlineEditableSelectCell({
  label,
  value,
  displayValue,
  options,
  disabled = false,
  onChange,
}: InlineEditableSelectCellProps) {
  const [editing, setEditing] = React.useState(false)
  const selectRef = React.useRef<HTMLSelectElement>(null)
  const originalValue = React.useRef(value)

  React.useEffect(() => {
    if (disabled) {
      setEditing(false)
    }
  }, [disabled])

  React.useEffect(() => {
    if (editing) {
      selectRef.current?.focus()
    }
  }, [editing])

  if (!editing) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="tm-agent-import__editable-cell"
              aria-label={`编辑${label}`}
              disabled={disabled}
              onClick={() => {
                originalValue.current = value
                setEditing(true)
              }}
            >
              <span>{displayValue || "—"}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>编辑{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <select
      ref={selectRef}
      aria-label={label}
      className="tm-agent-import__select tm-agent-import__select--compact"
      value={value}
      disabled={disabled}
      onBlur={() => setEditing(false)}
      onChange={(event) => {
        onChange(event.target.value)
        setEditing(false)
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          if (value !== originalValue.current) onChange(originalValue.current)
          setEditing(false)
        }
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function NewItemTableRow({
  draft,
  disabled,
  expanded,
  saving,
  onChange,
  onSave,
  onToggleDetails,
  onRequestTemplate,
}: AgentImportTableRowProps) {
  const item = draft.item
  const templateOptions = resolveItemTemplates(item)
  const waitingForAgent = Boolean(item.pendingTemplateEventId)
  const preview = item.template
    ? renderSystemTemplatePreview(item.template, item.templateInput)
    : null
  const firstDatasheet = item.material.datasheets[0]
  const updateMaterial = (key: keyof AgentImportItem["material"], value: string) => {
    onChange((current) => ({ ...current, material: { ...current.material, [key]: value } }))
  }

  return (
    <>
      <tr className={cn(!item.selected && "tm-agent-import__row--excluded")}>
        <td className="tm-agent-import__table-cell--select">
          <label className="tm-agent-import__selection" aria-label="导入此物料">
            <input
              type="checkbox"
              checked={item.selected}
              disabled={disabled}
              onChange={(event) =>
                onChange((current) => ({ ...current, selected: event.target.checked }))
              }
            />
          </label>
        </td>
        <td>
          <InlineEditableCell
            label="物料全名"
            value={item.material.fullName}
            disabled={disabled}
            onChange={(value) => updateMaterial("fullName", value)}
          />
        </td>
        <td>
          <InlineEditableCell
            label="基础型号"
            value={item.material.baseName ?? ""}
            disabled={disabled}
            onChange={(value) => updateMaterial("baseName", value)}
          />
        </td>
        <td>
          <InlineEditableCell
            label="变体"
            value={item.material.variantName ?? ""}
            disabled={disabled}
            onChange={(value) => updateMaterial("variantName", value)}
          />
        </td>
        <td>
          <InlineEditableCell
            label="封装"
            value={item.material.packageName ?? ""}
            disabled={disabled}
            onChange={(value) => updateMaterial("packageName", value)}
          />
        </td>
        <td>
          <InlineEditableCell
            label="入库数量"
            type="number"
            min={1}
            value={String(item.quantity)}
            disabled={disabled}
            onChange={(value) =>
              onChange((current) => ({
                ...current,
                quantity: Math.max(1, Number.parseInt(value, 10) || 1),
              }))
            }
          />
        </td>
        <td>
          <InlineEditableCell
            label="标签数量"
            type="number"
            min={1}
            value={String(item.labelPrintQuantity ?? 1)}
            disabled={disabled}
            onChange={(value) =>
              onChange((current) => ({
                ...current,
                labelPrintQuantity: Math.max(1, Number.parseInt(value, 10) || 1),
              }))
            }
          />
        </td>
        <td>
          <InlineEditableCell
            label="来源备注"
            value={item.sourceNote}
            disabled={disabled}
            onChange={(value) => onChange((current) => ({ ...current, sourceNote: value }))}
          />
        </td>
        <td>
          <DatasheetSummary datasheet={firstDatasheet} />
        </td>
        <td>
          <div className="tm-agent-import__template-cell">
            <InlineEditableSelectCell
              label="标签模板"
              value={item.template ? templateKey(item.template) : ""}
              displayValue={item.template?.name ?? "未选择模板"}
              options={templateOptions.map((template) => ({
                value: templateKey(template),
                label: template.name,
              }))}
              disabled={disabled || waitingForAgent || saving}
              onChange={(value) => {
                const next = templateOptions.find((template) => templateKey(template) === value)
                if (next) {
                  onRequestTemplate(next)
                }
              }}
            />
            {waitingForAgent ? (
              <span className="tm-agent-import__template-status">
                <LoaderCircle className="size-4 animate-spin" />
                等待 Agent 补全
              </span>
            ) : null}
          </div>
        </td>
        <td>
          <AttentionCell message={item.needsAttention} />
        </td>
        <td className="tm-agent-import__table-cell--action">
          <div className="tm-agent-import__item-actions">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={expanded ? "收起标签预览" : "预览标签"}
                    onClick={onToggleDetails}
                  >
                    <Eye className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{expanded ? "收起标签预览" : "预览标签"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <SaveItemAction saving={saving} disabled={disabled} onSave={onSave} />
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="tm-agent-import__detail-row">
          <td colSpan={12}>
            <div className="tm-agent-import__details">
              <section className="tm-agent-import__detail-section" aria-label="物料补充字段">
                <h3>物料补充</h3>
                <div className="tm-agent-import__field-grid tm-agent-import__field-grid--details">
                  <Field label="矩阵码">
                    <Input
                      density="compact"
                      size="lg"
                      value={item.material.matrixCode ?? ""}
                      disabled={disabled}
                      onChange={(event) => updateMaterial("matrixCode", event.target.value)}
                    />
                  </Field>
                  <Field label="描述" className="tm-agent-import__field--full">
                    <textarea
                      className="tm-agent-import__textarea tm-agent-import__textarea--compact"
                      value={item.material.description}
                      disabled={disabled}
                      onChange={(event) => updateMaterial("description", event.target.value)}
                    />
                  </Field>
                </div>
              </section>
              <section className="tm-agent-import__detail-section" aria-label="数据手册编辑">
                <h3>数据手册</h3>
                {firstDatasheet ? (
                  <div className="tm-agent-import__field-grid tm-agent-import__field-grid--details">
                    <Field label="标题">
                      <Input
                        density="compact"
                        size="lg"
                        value={firstDatasheet.title}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange((current) => ({
                            ...current,
                            material: {
                              ...current.material,
                              datasheets: current.material.datasheets.map((entry, index) =>
                                index === 0 ? { ...entry, title: event.target.value } : entry
                              ),
                            },
                          }))
                        }
                      />
                    </Field>
                    <Field label="链接">
                      <Input
                        density="compact"
                        size="lg"
                        value={firstDatasheet.url ?? ""}
                        disabled={disabled}
                        placeholder="制造商或授权分销商链接"
                        onChange={(event) =>
                          onChange((current) => ({
                            ...current,
                            material: {
                              ...current.material,
                              datasheets: current.material.datasheets.map((entry, index) =>
                                index === 0
                                  ? { ...entry, url: event.target.value || undefined }
                                  : entry
                              ),
                            },
                          }))
                        }
                      />
                    </Field>
                    <Field label="缺失原因" className="tm-agent-import__field--full">
                      <Input
                        density="compact"
                        size="lg"
                        value={firstDatasheet.missingReason ?? ""}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange((current) => ({
                            ...current,
                            material: {
                              ...current.material,
                              datasheets: current.material.datasheets.map((entry, index) =>
                                index === 0
                                  ? {
                                      ...entry,
                                      missingReason: event.target.value || undefined,
                                    }
                                  : entry
                              ),
                            },
                          }))
                        }
                      />
                    </Field>
                  </div>
                ) : (
                  <MissingDatasheetNotice />
                )}
              </section>
              <section
                className="tm-agent-import__detail-section tm-agent-import__detail-section--template"
                aria-label="标签预览与字段"
              >
                <h3>标签字段与预览</h3>
                <div className="tm-agent-import__label-preview">
                  {preview ? (
                    <img
                      src={`data:image/svg+xml,${encodeURIComponent(preview)}`}
                      alt={`${item.template?.name ?? "标签"}预览`}
                    />
                  ) : (
                    <>
                      <strong>{item.template?.name ?? "未选择模板"}</strong>
                      <span>
                        {item.template?.fields
                          .map((field) => item.templateInput[field.key] || field.label)
                          .join(" · ") || "等待模板字段"}
                      </span>
                    </>
                  )}
                </div>
                <div className="tm-agent-import__field-grid tm-agent-import__field-grid--template">
                  {(item.template?.fields ?? []).map((field) => (
                    <Field key={field.key} label={field.label} required={field.required}>
                      <Input
                        density="compact"
                        size="lg"
                        value={item.templateInput[field.key] ?? ""}
                        disabled={disabled || waitingForAgent || saving}
                        onChange={(event) =>
                          onChange((current) => ({
                            ...current,
                            templateInput: {
                              ...current.templateInput,
                              [field.key]: event.target.value,
                            },
                          }))
                        }
                      />
                    </Field>
                  ))}
                </div>
              </section>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function RestockItemTableRow({
  draft,
  disabled,
  restockTarget,
  saving,
  onChange,
  onSave,
}: AgentImportTableRowProps) {
  const item = draft.item
  const targetUnavailable = !restockTarget
  const material = restockTarget
  return (
    <tr className={cn(!item.selected && "tm-agent-import__row--excluded")}>
      <td className="tm-agent-import__table-cell--select">
        <label className="tm-agent-import__selection" aria-label="导入此物料">
          <input
            type="checkbox"
            checked={item.selected}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({ ...current, selected: event.target.checked }))
            }
          />
        </label>
      </td>
      <td className="tm-agent-import__target-material">
        <strong>{material?.fullName ?? "正在解析 DEVD 目标物料"}</strong>
      </td>
      <td>
        <span className="tm-agent-import__cell-copy">{item.targetMaterialId || "未提供"}</span>
      </td>
      <td>
        <span className="tm-agent-import__cell-copy">
          {[material?.baseName, material?.variantName].filter(Boolean).join(" · ") || "未提供"}
        </span>
      </td>
      <td>
        <span className="tm-agent-import__cell-copy">{material?.packageName || "未提供"}</span>
      </td>
      <td>
        <InlineEditableCell
          label="入库数量"
          type="number"
          min={1}
          value={String(item.quantity)}
          disabled={disabled || targetUnavailable}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              quantity: Math.max(1, Number.parseInt(value, 10) || 1),
            }))
          }
        />
      </td>
      <td>
        <InlineEditableCell
          label="来源备注"
          value={item.sourceNote}
          disabled={disabled || targetUnavailable}
          onChange={(value) => onChange((current) => ({ ...current, sourceNote: value }))}
        />
      </td>
      <td>
        {targetUnavailable || item.needsAttention || material?.datasheets?.length ? (
          <AttentionCell
            message={
              targetUnavailable ? "DEVD 中尚未找到可用于确认的目标物料。" : item.needsAttention
            }
          />
        ) : null}
        {!targetUnavailable && !material?.datasheets?.length ? <MissingDatasheetNotice /> : null}
      </td>
      <td className="tm-agent-import__table-cell--action">
        <SaveItemAction saving={saving} disabled={disabled || targetUnavailable} onSave={onSave} />
      </td>
    </tr>
  )
}

function AttentionCell({ message }: { message?: string }) {
  return message ? (
    <p className="tm-agent-import__attention-copy">
      <AlertTriangle className="size-4 text-amber-700" />
      <span>{message}</span>
    </p>
  ) : (
    <span className="tm-agent-import__no-attention">无额外提示</span>
  )
}

function MissingDatasheetNotice() {
  return (
    <p className="tm-agent-import__attention-copy">
      <AlertTriangle className="size-4 text-amber-700" />
      <span>未提供数据手册：建议补充制造商或授权分销商链接。</span>
    </p>
  )
}

function DatasheetSummary({
  datasheet,
}: {
  datasheet: AgentImportItem["material"]["datasheets"][number] | undefined
}) {
  if (!datasheet) {
    return <MissingDatasheetNotice />
  }
  if (!datasheet.url) {
    return <span className="tm-agent-import__cell-copy">{datasheet.title}</span>
  }
  return (
    <a
      className="tm-agent-import__datasheet-link"
      href={datasheet.url}
      target="_blank"
      rel="noreferrer"
    >
      {datasheet.title}
    </a>
  )
}

function SaveItemAction({
  saving,
  disabled,
  onSave,
}: {
  saving: boolean
  disabled: boolean
  onSave: () => void
}) {
  return saving ? (
    <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="正在保存" />
  ) : (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="tm-agent-import__save-action size-7"
            aria-label="保存当前编辑"
            disabled={disabled}
            onClick={onSave}
          >
            <Save className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>保存当前编辑</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function Field({
  label,
  required = false,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  const control = React.isValidElement<{ id?: string }>(children)
    ? React.cloneElement(children, { id })
    : children
  return (
    <div className={cn("tm-agent-import__field", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </Label>
      {control}
    </div>
  )
}

function EmptySection({ text }: { text: string }) {
  return <p className="tm-agent-import__empty">{text}</p>
}

function AgentImportLoading() {
  return (
    <main className="tm-agent-import tm-agent-import--state">
      <LoaderCircle className="size-5 animate-spin" />
      <span>正在读取受管导入会话…</span>
    </main>
  )
}

function AgentImportUnavailable({ message }: { message: string }) {
  return (
    <main className="tm-agent-import tm-agent-import--state">
      <Alert variant="destructive">
        <AlertTriangle className="mt-0.5 size-4" />
        <AlertTitle>无法打开确认页</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </main>
  )
}
