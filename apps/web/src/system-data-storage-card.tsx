import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  FolderOpen,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react"
import React from "react"

import { ActionButton } from "./components/ui/action-button.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js"
import {
  createDataArchiveBytes,
  readDataArchiveFile,
  TUCKMARK_DATA_ARCHIVE_SCHEMA,
} from "./data-directory-service.js"
import type {
  DataDirectoryAttachmentInspection,
  DataDirectoryBackupEntry,
  DataDirectoryManifestV1,
  DataDirectoryStatus,
  RuntimeSnapshotSummary,
} from "./data-directory-types.js"
import { devdDataClient } from "./devd-data-client.js"
import type { CanvasDraftSource } from "./types.js"
import type { WorkbenchDataDirectoryDialogState } from "./workbench-controller.js"

type DataStorageCardProps = {
  busy: string | null
  dialog: WorkbenchDataDirectoryDialogState | null
  status: DataDirectoryStatus
  onCancelDialog: () => void
  onChooseDirectory: () => void
  onConfirmAttachment: (mode: "overwrite-current" | "import-existing") => void
  onConfirmImport: () => void
  onConfirmRestore: () => void
  onConfirmForcedReplacement: () => void
  onCreateBackup: () => void
  onExportArchive: () => void
  onInspectImportArchive: (file: File) => void
  onInspectRestoreBackup: (entry: DataDirectoryBackupEntry) => void
  onRequestPermission: () => void
  onOpenForceReplacementConfirmation: () => void
  onRequestDraftAttention: (sourceKey: string) => void
  onSyncNow: () => void
  onTakeOverWrites: () => void
}

function getCanvasDraftPath(source: CanvasDraftSource): string {
  if (source.kind === "user-template") {
    return `/canvas?source=user-template&templateId=${encodeURIComponent(source.templateId)}`
  }
  if (source.kind === "preset-template") {
    return `/canvas?source=preset-template&templateId=${encodeURIComponent(source.presetId)}`
  }
  return `/canvas?presetId=${encodeURIComponent(source.presetId)}`
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "未记录"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function summarizeSnapshot(summary: RuntimeSnapshotSummary): string {
  return [
    `${summary.templates} 模板`,
    `${summary.versions} 版本`,
    `${summary.workingCopies} 草稿`,
    `${summary.materials} 物料`,
    `${summary.adjustments} 流水`,
  ].join(" / ")
}

function summarizeManifestCounts(counts: DataDirectoryManifestV1["counts"]): string {
  return [
    `${counts.templates} 模板`,
    `${counts.versions} 版本`,
    `${counts.workingCopies} 草稿`,
    `${counts.materials} 物料`,
    `${counts.adjustments} 流水`,
  ].join(" / ")
}

function getHealthBadge(status: DataDirectoryStatus) {
  switch (status.health) {
    case "healthy":
      return <Badge variant="secondary">主存储正常</Badge>
    case "permission-required":
      return <Badge variant="outline">等待授权</Badge>
    case "unconfigured":
      return <Badge variant="outline">未配置</Badge>
    case "unsupported":
      return <Badge variant="outline">环境不支持</Badge>
    case "error":
      return <Badge variant="destructive">需要处理</Badge>
  }
}

function getConnectionLabel(status: DataDirectoryStatus): string {
  return status.connectionState === "connected" ? "已连接" : "正在重连"
}

function DevdDataStorageCard({ status }: { status: DataDirectoryStatus }) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<{
    archive: unknown
    archiveHash: string
    summary: Record<string, number>
    conflicts: string[]
  } | null>(null)
  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name)
    setError(null)
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DEVD 操作失败。")
    } finally {
      setBusy(null)
    }
  }
  const exportArchive = () =>
    run("export", async () => {
      const archive = await devdDataClient.exportArchive()
      const bytes = createDataArchiveBytes({
        schema: TUCKMARK_DATA_ARCHIVE_SCHEMA,
        exportedAt: archive.exportedAt,
        runtime: archive.runtime,
        inventory: archive.inventory,
      })
      const blobBytes = new Uint8Array(bytes.byteLength)
      blobBytes.set(bytes)
      const url = URL.createObjectURL(new Blob([blobBytes.buffer], { type: "application/zip" }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `tuckmark-export-${Date.now()}.zip`
      anchor.click()
      URL.revokeObjectURL(url)
    })
  const inspectFile = (file: File) =>
    run("inspect", async () => {
      const dataArchive = await readDataArchiveFile(file)
      const archive = {
        schema: "tuckmark.devd-data-archive.v1",
        exportedAt: dataArchive.exportedAt,
        runtime: dataArchive.runtime,
        inventory: dataArchive.inventory,
      }
      const inspection = await devdDataClient.inspectArchive(archive)
      setPending({ archive, ...inspection })
    })
  const importArchive = (mode: "merge" | "replace") =>
    run(`import-${mode}`, async () => {
      if (!pending) return
      await devdDataClient.importArchive(pending.archive, pending.archiveHash, mode)
      setPending(null)
      window.location.reload()
    })
  return (
    <>
      <Card className="tm-panel">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2">DEVD 数据存储</CardTitle>
            {getHealthBadge(status)}
          </div>
          <div className="text-sm text-muted-foreground">
            模板、草稿、库存与应用设置由本机 DEVD 统一持久化。当前页面不会请求浏览器目录权限。
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {status.health === "healthy" ? (
            <Alert>
              <CheckCircle2 className="mt-0.5 size-4" />
              <AlertTitle>DEVD 数据服务正常</AlertTitle>
              <AlertDescription>数据命令与实时失效通知均通过本机服务处理。</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>DEVD 数据服务不可用</AlertTitle>
              <AlertDescription>
                {status.lastError ?? "无法读取服务状态，请检查 DEVD。"}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 text-sm text-muted-foreground">
            <div className="tm-list-item">
              <span>数据目录</span>
              <strong>{status.directoryName ?? "不可用"}</strong>
            </div>
            <div className="tm-list-item">
              <span>全局 revision</span>
              <strong>{status.revision ?? "未读取"}</strong>
            </div>
            <div className="tm-list-item">
              <span>实时连接</span>
              <strong>{getConnectionLabel(status)}</strong>
            </div>
            <div className="tm-list-item">
              <span>当前数据集</span>
              <strong>{summarizeSnapshot(status.runtimeSummary)}</strong>
            </div>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>DEVD 操作失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div
            className="flex flex-wrap items-center gap-2"
            role="toolbar"
            aria-label="DEVD 数据维护操作"
          >
            <ActionButton
              type="button"
              name="立即备份"
              icon={Archive}
              mode="icon-text"
              size="sm"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("backup", async () => {
                  await devdDataClient.createBackup()
                })
              }
            />
            <ActionButton
              type="button"
              name="导出 ZIP 数据"
              icon={Download}
              mode="icon-text"
              size="sm"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => void exportArchive()}
            />
            <ActionButton
              type="button"
              name="导入 ZIP 数据"
              icon={Upload}
              mode="icon-text"
              size="sm"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => inputRef.current?.click()}
            />
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.currentTarget.value = ""
                if (file) void inspectFile(file)
              }}
            />
          </div>
        </CardContent>
      </Card>
      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认导入 DEVD 数据</DialogTitle>
            <DialogDescription>
              合并只接受纯新增数据；替换会先创建保护备份，再整库写入。
            </DialogDescription>
          </DialogHeader>
          {pending ? (
            <div className="grid gap-2 text-sm text-muted-foreground">
              <div className="tm-list-item">
                <span>快照规模</span>
                <strong>{`${pending.summary.templates ?? 0} 模板 / ${pending.summary.materials ?? 0} 物料 / ${pending.summary.adjustments ?? 0} 流水`}</strong>
              </div>
              <div className="tm-list-item">
                <span>合并预检</span>
                <strong>
                  {pending.conflicts.length === 0 ? "无冲突" : `${pending.conflicts.length} 项冲突`}
                </strong>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(pending?.conflicts.length) || Boolean(busy)}
              onClick={() => void importArchive("merge")}
            >
              合并新增
            </Button>
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void importArchive("replace")}
            >
              备份并替换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function getLeaseAlert(status: DataDirectoryStatus, onTakeOverWrites: () => void) {
  if (status.leaseRole !== "follower") {
    return null
  }
  return (
    <Alert>
      <AlertCircle className="mt-0.5 size-4" />
      <AlertTitle>当前标签不是写入者</AlertTitle>
      <AlertDescription className="grid gap-3">
        <span>另一个标签正在持有写入租约。你仍能查看状态，但目录同步与备份将由持有者负责。</span>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onTakeOverWrites}>
            <ShieldCheck className="size-4" />
            <span>接管写入</span>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function DataDirectoryAttachmentDialog({
  inspection,
  open,
  onCancel,
  onConfirm,
}: {
  inspection: DataDirectoryAttachmentInspection | null
  open: boolean
  onCancel: () => void
  onConfirm: (mode: "overwrite-current" | "import-existing") => void
}) {
  if (!inspection) {
    return null
  }

  const isExisting = inspection.kind === "existing"
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isExisting ? "发现已有数据目录" : "确认接入数据目录"}</DialogTitle>
          <DialogDescription>
            {isExisting
              ? `目录“${inspection.handleName}”里已经存在 Tuckmark 数据。请选择导入目录数据，或用当前浏览器数据覆盖它。`
              : inspection.entryCount > 0
                ? `目录“${inspection.handleName}”不是空目录，但还没有 Tuckmark manifest。确认后会把当前浏览器数据写入这个目录。`
                : `目录“${inspection.handleName}”当前为空。确认后会把当前浏览器数据写入这个目录。`}
          </DialogDescription>
        </DialogHeader>
        {isExisting ? (
          <div className="grid gap-2 text-sm text-muted-foreground">
            <div className="tm-list-item">
              <span>目录快照</span>
              <strong>{summarizeManifestCounts(inspection.manifest.counts)}</strong>
            </div>
            <div className="tm-list-item">
              <span>最近生成</span>
              <strong>{formatTimestamp(inspection.manifest.generatedAt)}</strong>
            </div>
          </div>
        ) : null}
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          {isExisting ? (
            <>
              <Button type="button" variant="outline" onClick={() => onConfirm("import-existing")}>
                导入目录数据
              </Button>
              <Button type="button" onClick={() => onConfirm("overwrite-current")}>
                用当前数据覆盖
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => onConfirm("overwrite-current")}>
              写入当前数据
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveConfirmDialog({
  open,
  title,
  description,
  inspection,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  inspection: WorkbenchDataDirectoryDialogState | null
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  if (
    !inspection ||
    (inspection.kind !== "import-confirm" && inspection.kind !== "restore-confirm")
  ) {
    return null
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm text-muted-foreground">
          <div className="tm-list-item">
            <span>数据来源</span>
            <strong>{inspection.inspection.label}</strong>
          </div>
          <div className="tm-list-item">
            <span>快照规模</span>
            <strong>{summarizeSnapshot(inspection.inspection.summary)}</strong>
          </div>
          <div className="tm-list-item">
            <span>快照时间</span>
            <strong>{formatTimestamp(inspection.inspection.summary.snapshotUpdatedAt)}</strong>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PendingDraftsDialog({
  dialog,
  onCancel,
  onForce,
  onConfirmForce,
  onRequestDraftAttention,
}: {
  dialog: WorkbenchDataDirectoryDialogState | null
  onCancel: () => void
  onForce: () => void
  onConfirmForce: () => void
  onRequestDraftAttention: (sourceKey: string) => void
}) {
  if (!dialog || (dialog.kind !== "drafts-required" && dialog.kind !== "force-replace")) {
    return null
  }
  const forceConfirmation = dialog.kind === "force-replace"
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {forceConfirmation ? "确认强制替换数据集" : "请先处理未保存草稿"}
          </DialogTitle>
          <DialogDescription>
            {forceConfirmation
              ? "强制替换会放弃下列草稿及无响应标签尚未写入的数据。该操作不可撤销。"
              : "切换目录或整库恢复会替换当前画布数据。已在画布标签页打开的草稿会收到处理提示；其余草稿可在当前标签页打开。保存或重置全部草稿后再重试。"}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          {dialog.drafts.map((draft) => (
            <li key={draft.sourceKey} className="tm-list-item gap-3">
              <div className="grid min-w-0 gap-0.5">
                <strong className="truncate">{draft.label}</strong>
                <span className="text-xs text-muted-foreground">
                  {draft.source.kind === "user-template" ? "用户模板草稿" : "画布草稿"} ·{" "}
                  {formatTimestamp(draft.updatedAt)}
                </span>
              </div>
              {!forceConfirmation ? (
                draft.activeCanvasTabCount > 0 ? (
                  <div className="grid justify-items-end gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRequestDraftAttention(draft.sourceKey)}
                    >
                      提醒画布标签页处理
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {draft.attentionRequested
                        ? "已发送处理提示，请手动切换到该标签页。"
                        : `已在 ${draft.activeCanvasTabCount} 个画布标签页打开`}
                    </span>
                  </div>
                ) : (
                  <Button asChild type="button" variant="outline" size="sm">
                    <a href={getCanvasDraftPath(draft.source)}>在此标签页处理</a>
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          {forceConfirmation ? (
            <Button type="button" variant="destructive" onClick={onConfirmForce}>
              放弃草稿并替换
            </Button>
          ) : (
            <Button type="button" variant="destructive" onClick={onForce}>
              管理员强制替换
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SystemDataStorageCard({
  busy,
  dialog,
  status,
  onCancelDialog,
  onChooseDirectory,
  onConfirmAttachment,
  onConfirmImport,
  onConfirmRestore,
  onConfirmForcedReplacement,
  onCreateBackup,
  onExportArchive,
  onInspectImportArchive,
  onInspectRestoreBackup,
  onRequestPermission,
  onOpenForceReplacementConfirmation,
  onRequestDraftAttention,
  onSyncNow,
  onTakeOverWrites,
}: DataStorageCardProps) {
  const importInputRef = React.useRef<HTMLInputElement | null>(null)

  if (status.owner === "devd") {
    return <DevdDataStorageCard status={status} />
  }

  return (
    <>
      <Card className="tm-panel">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle as="h2">本地数据目录与备份</CardTitle>
            {getHealthBadge(status)}
          </div>
          <div className="text-sm text-muted-foreground">
            {status.supported
              ? "已授权目录会作为统一数据目录，承载模板与库存 JSON 数据树，并支持迁移、备份恢复与 ZIP 导入导出。"
              : "当前环境不支持目录句柄与本地数据目录接入。应用仍可继续使用浏览器内存储，但目录绑定、备份恢复与整库导入导出已禁用。"}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {getLeaseAlert(status, onTakeOverWrites)}

          {status.health === "permission-required" ? (
            <Alert variant="destructive">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>目录权限需要重新确认</AlertTitle>
              <AlertDescription>
                目录句柄还在，但当前会话没有读写权限。点击“重新请求权限”后再执行同步、备份或恢复。
              </AlertDescription>
            </Alert>
          ) : null}

          {status.health === "healthy" ? (
            <Alert>
              <CheckCircle2 className="mt-0.5 size-4" />
              <AlertTitle>本地数据目录可用</AlertTitle>
              <AlertDescription>
                当前数据目录可读写，最近一次目录写入时间为 {formatTimestamp(status.lastSyncAt)}。
              </AlertDescription>
            </Alert>
          ) : null}

          {status.lastError ? (
            <Alert variant="destructive">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>最近一次目录操作失败</AlertTitle>
              <AlertDescription>{status.lastError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 text-sm text-muted-foreground">
            <div className="tm-list-item">
              <span>目录状态</span>
              <strong>{status.directoryName ?? "未配置"}</strong>
            </div>
            <div className="tm-list-item">
              <span>权限</span>
              <strong>{status.permissionState}</strong>
            </div>
            <div className="tm-list-item">
              <span>当前数据集</span>
              <strong>{summarizeSnapshot(status.runtimeSummary)}</strong>
            </div>
            <div className="tm-list-item">
              <span>最近同步</span>
              <strong>{formatTimestamp(status.lastSyncAt)}</strong>
            </div>
            {status.manifest ? (
              <div className="tm-list-item">
                <span>目录主链快照</span>
                <strong>{summarizeManifestCounts(status.manifest.counts)}</strong>
              </div>
            ) : null}
          </div>

          <div
            className="flex flex-wrap items-center gap-2"
            role="toolbar"
            aria-label="浏览器数据维护操作"
          >
            <ActionButton
              type="button"
              name={status.configured ? "更换目录" : "授权目录"}
              icon={FolderOpen}
              mode="icon-text"
              size="sm"
              variant="outline"
              onClick={onChooseDirectory}
              disabled={!status.supported}
            />
            <ActionButton
              type="button"
              name="重新请求权限"
              icon={ShieldCheck}
              mode="icon-text"
              size="sm"
              variant="outline"
              onClick={onRequestPermission}
              disabled={!status.configured || !status.supported}
            />
            <ActionButton
              type="button"
              name="立即同步"
              icon={RefreshCcw}
              mode="icon-text"
              size="sm"
              variant="outline"
              onClick={onSyncNow}
              disabled={!status.configured || !status.supported || status.leaseRole === "follower"}
              className={busy === "sync-data-directory" ? "[&_svg]:animate-spin" : undefined}
            />
            <ActionButton
              type="button"
              name="立即备份"
              icon={Archive}
              mode="icon-text"
              size="sm"
              variant="outline"
              onClick={onCreateBackup}
              disabled={!status.configured || !status.supported || status.leaseRole === "follower"}
            />
            <ActionButton
              type="button"
              name="导出 ZIP 数据"
              icon={Download}
              mode="icon-text"
              size="sm"
              variant="outline"
              onClick={onExportArchive}
            />
            <ActionButton
              type="button"
              name="导入 ZIP 数据"
              icon={Upload}
              mode="icon-text"
              size="sm"
              variant="outline"
              onClick={() => importInputRef.current?.click()}
            />
            <input
              ref={importInputRef}
              hidden
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.currentTarget.value = ""
                if (file) {
                  onInspectImportArchive(file)
                }
              }}
            />
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-medium">固定位置备份</div>
            {status.backups.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                还没有备份文件。手动备份会写入目录下的
                `backups/manual/`，恢复或导入前的保护快照会写入 `backups/protection/`。
              </div>
            ) : (
              <div className="grid gap-2">
                {status.backups.map((entry) => (
                  <div
                    key={entry.path}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
                  >
                    <div className="grid gap-1">
                      <div className="font-medium text-foreground">{entry.name}</div>
                      <div className="text-muted-foreground">
                        {entry.kind === "manual" ? "手动备份" : "保护快照"} ·{" "}
                        {formatTimestamp(entry.modifiedAt)} · {formatBytes(entry.size)}
                      </div>
                    </div>
                    <ActionButton
                      type="button"
                      name="恢复备份"
                      icon={RotateCcw}
                      mode="icon-text"
                      size="sm"
                      variant="outline"
                      onClick={() => onInspectRestoreBackup(entry)}
                      disabled={status.leaseRole === "follower"}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <DataDirectoryAttachmentDialog
        open={dialog?.kind === "attach-choice"}
        inspection={dialog?.kind === "attach-choice" ? dialog.inspection : null}
        onCancel={onCancelDialog}
        onConfirm={onConfirmAttachment}
      />

      <ArchiveConfirmDialog
        open={dialog?.kind === "import-confirm"}
        title="确认导入整库数据"
        description="导入会用 ZIP 中的数据替换当前浏览器数据集；如果已配置数据目录，会先自动写入一份保护快照。"
        inspection={dialog}
        confirmLabel="开始导入"
        onCancel={onCancelDialog}
        onConfirm={onConfirmImport}
      />

      <ArchiveConfirmDialog
        open={dialog?.kind === "restore-confirm"}
        title="确认恢复备份"
        description="恢复会整库替换当前浏览器数据，并在执行前先写入一份保护快照。"
        inspection={dialog}
        confirmLabel="恢复备份"
        onCancel={onCancelDialog}
        onConfirm={onConfirmRestore}
      />

      <PendingDraftsDialog
        dialog={dialog}
        onCancel={onCancelDialog}
        onForce={onOpenForceReplacementConfirmation}
        onConfirmForce={onConfirmForcedReplacement}
        onRequestDraftAttention={onRequestDraftAttention}
      />
    </>
  )
}
