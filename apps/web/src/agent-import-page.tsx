import type {
  AgentImportItem,
  AgentImportLocalTemplate,
  AgentImportSession,
  AgentImportTemplate,
} from "@tuckmark/inventory"
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  LoaderCircle,
  PackagePlus,
  RefreshCcw,
  Save,
  Warehouse,
} from "lucide-react"
import React from "react"
import { buildSvg, getTemplateById } from "../../../packages/core/src/web.js"

import { type AgentImportClient, HttpAgentImportClient } from "./agent-import-client.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Input } from "./components/ui/input.js"
import { Label } from "./components/ui/label.js"
import { cn } from "./lib/utils.js"
import type { UserTemplateSummary } from "./types.js"
import { listUserTemplates } from "./user-template-store.js"

type ItemDraft = {
  item: AgentImportItem
  serverRevision: number
}

type AgentImportPageProps = {
  sessionId?: string
  secret?: string
  client?: AgentImportClient
  localTemplatesLoader?: () => Promise<UserTemplateSummary[]>
  initialSession?: AgentImportSession
}

type ManualTemplate = {
  template: AgentImportTemplate
  snapshot: AgentImportLocalTemplate
}

function toManualTemplate(template: UserTemplateSummary): ManualTemplate | null {
  if (!template.document) {
    return null
  }
  const agentTemplate: AgentImportTemplate = {
    source: "user-template",
    id: template.id,
    name: template.name,
    fields: template.fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: false,
      multiline: field.multiline,
    })),
    recommendedUses: [],
  }
  return {
    template: agentTemplate,
    snapshot: {
      template: agentTemplate,
      description: template.description,
      document: template.document,
    },
  }
}

function reconcileDrafts(
  current: Record<string, ItemDraft>,
  session: AgentImportSession
): Record<string, ItemDraft> {
  const next: Record<string, ItemDraft> = {}
  for (const item of session.proposal.items) {
    const previous = current[item.id]
    next[item.id] =
      previous && previous.serverRevision === item.revision
        ? previous
        : { item, serverRevision: item.revision }
  }
  return next
}

function templateKey(template: AgentImportTemplate): string {
  return `${template.source}:${template.id}`
}

function resolveItemTemplates(
  item: AgentImportItem,
  manualTemplates: AgentImportTemplate[]
): AgentImportTemplate[] {
  const values = [
    ...(item.template ? [item.template] : []),
    ...item.templateAlternatives,
    ...manualTemplates,
  ]
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
  client = new HttpAgentImportClient(),
  localTemplatesLoader = listUserTemplates,
  initialSession,
}: AgentImportPageProps) {
  const [session, setSession] = React.useState<AgentImportSession | null>(initialSession ?? null)
  const [drafts, setDrafts] = React.useState<Record<string, ItemDraft>>(() =>
    initialSession ? reconcileDrafts({}, initialSession) : {}
  )
  const [manualTemplates, setManualTemplates] = React.useState<ManualTemplate[]>([])
  const [loading, setLoading] = React.useState(!initialSession)
  const [savingItemId, setSavingItemId] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const applySession = React.useCallback((next: AgentImportSession) => {
    setSession(next)
    setDrafts((current) => reconcileDrafts(current, next))
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
    void localTemplatesLoader()
      .then((templates) =>
        setManualTemplates(
          templates
            .map(toManualTemplate)
            .filter((template): template is ManualTemplate => Boolean(template))
        )
      )
      .catch(() => setManualTemplates([]))
  }, [localTemplatesLoader])

  React.useEffect(() => {
    if (!sessionId || !secret || !session || session.state !== "open") {
      return
    }
    const interval = window.setInterval(() => {
      void client
        .getSession(sessionId, secret)
        .then((next) => {
          applySession(next)
          setError(null)
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

  const requestTemplate = React.useCallback(
    async (
      itemId: string,
      template: AgentImportTemplate,
      localTemplate: AgentImportLocalTemplate | undefined
    ) => {
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
          localTemplate,
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
        icon={<PackagePlus className="size-5" />}
        title="新增物品"
        description="创建物料、绑定一个标签模板，并写入入库流水。"
        count={newItems.length}
      >
        {newItems.length ? (
          newItems.map((item) => {
            const draft = drafts[item.id]
            return draft ? (
              <AgentImportItemEditor
                key={item.id}
                draft={draft}
                disabled={isCompleted}
                manualTemplates={manualTemplates.map((template) => template.template)}
                localTemplateFor={(template) =>
                  manualTemplates.find(
                    (candidate) => templateKey(candidate.template) === templateKey(template)
                  )?.snapshot
                }
                saving={savingItemId === item.id}
                onChange={(update) => updateDraft(item.id, update)}
                onSave={() => void saveItem(item.id)}
                onRequestTemplate={(template, localTemplate) =>
                  void requestTemplate(item.id, template, localTemplate)
                }
              />
            ) : null
          })
        ) : (
          <EmptySection text="该会话没有新增物品。" />
        )}
      </ImportSection>

      <ImportSection
        icon={<Warehouse className="size-5" />}
        title="增加库存"
        description="仅向 Agent 指定的已有物料写入入库流水，保留原有标签绑定。"
        count={restockItems.length}
      >
        {restockItems.length ? (
          restockItems.map((item) => {
            const draft = drafts[item.id]
            return draft ? (
              <AgentImportItemEditor
                key={item.id}
                draft={draft}
                disabled={isCompleted}
                manualTemplates={[]}
                localTemplateFor={() => undefined}
                saving={savingItemId === item.id}
                onChange={(update) => updateDraft(item.id, update)}
                onSave={() => void saveItem(item.id)}
                onRequestTemplate={() => undefined}
              />
            ) : null
          })
        ) : (
          <EmptySection text="该会话没有增加库存项。" />
        )}
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
          disabled={isCompleted || confirming || Boolean(savingItemId) || pendingTemplateInput}
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
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  count: number
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
      <div className="tm-agent-import__items">{children}</div>
    </section>
  )
}

function AgentImportItemEditor({
  draft,
  disabled,
  manualTemplates,
  localTemplateFor,
  saving,
  onChange,
  onSave,
  onRequestTemplate,
}: {
  draft: ItemDraft
  disabled: boolean
  manualTemplates: AgentImportTemplate[]
  localTemplateFor: (template: AgentImportTemplate) => AgentImportLocalTemplate | undefined
  saving: boolean
  onChange: (update: (item: AgentImportItem) => AgentImportItem) => void
  onSave: () => void
  onRequestTemplate: (
    template: AgentImportTemplate,
    localTemplate: AgentImportLocalTemplate | undefined
  ) => void
}) {
  const item = draft.item
  const templateOptions = resolveItemTemplates(item, manualTemplates)
  const waitingForAgent = Boolean(item.pendingTemplateEventId)
  const materialReadOnly = item.kind === "restock"
  const materialDisabled = disabled || materialReadOnly
  const preview = item.template
    ? renderSystemTemplatePreview(item.template, item.templateInput)
    : null
  const firstDatasheet = item.material.datasheets[0]
  const updateMaterial = (key: keyof AgentImportItem["material"], value: string) => {
    onChange((current) => ({ ...current, material: { ...current.material, [key]: value } }))
  }

  return (
    <article
      className={cn("tm-agent-import__item", !item.selected && "tm-agent-import__item--excluded")}
    >
      <header className="tm-agent-import__item-header">
        <label className="tm-agent-import__selection">
          <input
            type="checkbox"
            checked={item.selected}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({ ...current, selected: event.target.checked }))
            }
          />
          <span>{item.selected ? "将导入" : "不导入"}</span>
        </label>
        <div className="tm-agent-import__item-actions">
          {item.needsAttention ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-800">
              需要注意
            </Badge>
          ) : null}
          {saving ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="保存当前编辑"
              disabled={disabled}
              onClick={onSave}
            >
              <Save className="size-4" />
            </Button>
          )}
        </div>
      </header>

      {item.needsAttention ? (
        <Alert className="tm-agent-import__attention">
          <AlertTriangle className="mt-0.5 size-4 text-amber-700" />
          <AlertTitle>Agent 提示</AlertTitle>
          <AlertDescription>{item.needsAttention}</AlertDescription>
        </Alert>
      ) : null}

      {item.kind === "restock" ? (
        <p className="mb-3 text-xs text-muted-foreground">
          补库存沿用目标物料的资料与标签绑定；可调整入库数量、来源备注和是否导入。
        </p>
      ) : null}

      <div className="tm-agent-import__form-grid">
        <Field label="物料全名" required>
          <Input
            value={item.material.fullName}
            disabled={materialDisabled}
            onChange={(event) => updateMaterial("fullName", event.target.value)}
          />
        </Field>
        <Field label="入库数量" required>
          <Input
            type="number"
            min="1"
            value={item.quantity}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                quantity: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
              }))
            }
          />
        </Field>
        {item.kind === "restock" ? (
          <Field label="目标物料 ID" required>
            <Input value={item.targetMaterialId ?? ""} disabled={materialDisabled} />
          </Field>
        ) : null}
        <Field label="基础型号">
          <Input
            value={item.material.baseName ?? ""}
            disabled={materialDisabled}
            onChange={(event) => updateMaterial("baseName", event.target.value)}
          />
        </Field>
        <Field label="变体">
          <Input
            value={item.material.variantName ?? ""}
            disabled={materialDisabled}
            onChange={(event) => updateMaterial("variantName", event.target.value)}
          />
        </Field>
        <Field label="封装">
          <Input
            value={item.material.packageName ?? ""}
            disabled={materialDisabled}
            onChange={(event) => updateMaterial("packageName", event.target.value)}
          />
        </Field>
        <Field label="矩阵码">
          <Input
            value={item.material.matrixCode ?? ""}
            disabled={materialDisabled}
            onChange={(event) => updateMaterial("matrixCode", event.target.value)}
          />
        </Field>
        <Field label="来源备注" className="tm-agent-import__field--wide">
          <Input
            value={item.sourceNote}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) => ({ ...current, sourceNote: event.target.value }))
            }
          />
        </Field>
        <Field label="描述" className="tm-agent-import__field--wide">
          <textarea
            className="tm-agent-import__textarea"
            value={item.material.description}
            disabled={materialDisabled}
            onChange={(event) => updateMaterial("description", event.target.value)}
          />
        </Field>
      </div>

      <section className="tm-agent-import__datasheet" aria-label="数据手册">
        <div className="tm-agent-import__subheading">
          <FileText className="size-4" />
          <h3>数据手册</h3>
        </div>
        {firstDatasheet ? (
          <div className="tm-agent-import__form-grid">
            <Field label="标题">
              <Input
                value={firstDatasheet.title}
                disabled={materialDisabled}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    material: {
                      ...current.material,
                      datasheets: [{ ...firstDatasheet, title: event.target.value }],
                    },
                  }))
                }
              />
            </Field>
            <Field label="链接" className="tm-agent-import__field--wide">
              <Input
                value={firstDatasheet.url ?? ""}
                disabled={materialDisabled}
                placeholder="制造商或授权分销商链接"
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    material: {
                      ...current.material,
                      datasheets: [{ ...firstDatasheet, url: event.target.value || undefined }],
                    },
                  }))
                }
              />
            </Field>
            {firstDatasheet.missingReason ? (
              <Field label="缺失原因" className="tm-agent-import__field--wide">
                <Input
                  value={firstDatasheet.missingReason}
                  disabled={materialDisabled}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      material: {
                        ...current.material,
                        datasheets: [
                          { ...firstDatasheet, missingReason: event.target.value || undefined },
                        ],
                      },
                    }))
                  }
                />
              </Field>
            ) : null}
          </div>
        ) : (
          <Alert className="tm-agent-import__attention">
            <AlertTriangle className="mt-0.5 size-4 text-amber-700" />
            <AlertTitle>未提供数据手册</AlertTitle>
            <AlertDescription>电子元器件建议补充制造商或授权分销商链接。</AlertDescription>
          </Alert>
        )}
      </section>

      {item.kind === "new" ? (
        <section className="tm-agent-import__template" aria-label="标签模板">
          <div className="tm-agent-import__subheading">
            <RefreshCcw className="size-4" />
            <h3>标签模板与预览</h3>
          </div>
          <div className="tm-agent-import__template-grid">
            <Field label="标签模板">
              <select
                className="tm-agent-import__select"
                value={item.template ? templateKey(item.template) : ""}
                disabled={disabled || waitingForAgent || saving}
                onChange={(event) => {
                  const next = templateOptions.find(
                    (template) => templateKey(template) === event.target.value
                  )
                  if (next) {
                    onRequestTemplate(next, localTemplateFor(next))
                  }
                }}
              >
                {templateOptions.map((template) => (
                  <option key={templateKey(template)} value={templateKey(template)}>
                    {template.name}
                    {manualTemplates.some(
                      (candidate) => templateKey(candidate) === templateKey(template)
                    )
                      ? "（本地）"
                      : ""}
                  </option>
                ))}
              </select>
            </Field>
            <div className="tm-agent-import__template-status">
              {waitingForAgent ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  等待 Agent 根据字段合同补全
                </>
              ) : (
                "可在导入前编辑字段"
              )}
            </div>
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
          </div>
          <div className="tm-agent-import__form-grid">
            {(item.template?.fields ?? []).map((field) => (
              <Field key={field.key} label={field.label} required={field.required}>
                <Input
                  value={item.templateInput[field.key] ?? ""}
                  disabled={disabled || waitingForAgent || saving}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      templateInput: { ...current.templateInput, [field.key]: event.target.value },
                    }))
                  }
                />
              </Field>
            ))}
          </div>
        </section>
      ) : null}
    </article>
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
