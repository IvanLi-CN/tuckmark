import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpToLine,
  CheckCircle2,
  FolderOpen,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react"
import React from "react"

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
import type {
  DataDirectoryAttachmentInspection,
  DataDirectoryBackupEntry,
  DataDirectoryStatus,
  RuntimeSnapshotSummary,
} from "./data-directory-types.js"
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
  onCreateBackup: () => void
  onExportArchive: () => void
  onInspectImportArchive: (file: File) => void
  onInspectRestoreBackup: (entry: DataDirectoryBackupEntry) => void
  onRequestPermission: () => void
  onSyncNow: () => void
  onTakeOverWrites: () => void
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
  return `${summary.templates} 模板 / ${summary.versions} 版本 / ${summary.workingCopies} 草稿`
}

function getHealthBadge(status: DataDirectoryStatus) {
  switch (status.health) {
    case "healthy":
      return <Badge variant="secondary">镜像正常</Badge>
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
              <strong>
                {inspection.manifest.counts.templates} 模板 / {inspection.manifest.counts.versions}{" "}
                版本
              </strong>
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

export function SystemDataStorageCard({
  busy,
  dialog,
  status,
  onCancelDialog,
  onChooseDirectory,
  onConfirmAttachment,
  onConfirmImport,
  onConfirmRestore,
  onCreateBackup,
  onExportArchive,
  onInspectImportArchive,
  onInspectRestoreBackup,
  onRequestPermission,
  onSyncNow,
  onTakeOverWrites,
}: DataStorageCardProps) {
  const importInputRef = React.useRef<HTMLInputElement | null>(null)

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
              ? "浏览器内数据由 SQLite + OPFS 持久化，已授权目录会同步为可读的 JSON 数据树，并支持 ZIP 导入导出。"
              : "当前环境不支持目录句柄与磁盘镜像。应用仍可继续使用浏览器内存储，但目录同步、备份恢复与整库导入导出已禁用。"}
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
              <AlertTitle>目录镜像健康</AlertTitle>
              <AlertDescription>
                当前数据目录可读写，最近一次 JSON 镜像时间为 {formatTimestamp(status.lastSyncAt)}。
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
                <span>目录镜像快照</span>
                <strong>
                  {status.manifest.counts.templates} 模板 / {status.manifest.counts.versions} 版本
                </strong>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onChooseDirectory}
              disabled={!status.supported}
            >
              <FolderOpen className="size-4" />
              <span>{status.configured ? "更换目录" : "授权目录"}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onRequestPermission}
              disabled={!status.configured || !status.supported}
            >
              <ShieldCheck className="size-4" />
              <span>重新请求权限</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onSyncNow}
              disabled={!status.configured || !status.supported || status.leaseRole === "follower"}
            >
              <RefreshCcw
                className={busy === "sync-data-directory" ? "size-4 animate-spin" : "size-4"}
              />
              <span>立即同步</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCreateBackup}
              disabled={!status.configured || !status.supported || status.leaseRole === "follower"}
            >
              <ArrowDownToLine className="size-4" />
              <span>立即备份</span>
            </Button>
            <Button type="button" variant="outline" onClick={onExportArchive}>
              <ArrowUpToLine className="size-4" />
              <span>导出数据</span>
            </Button>
            <Button type="button" variant="outline" onClick={() => importInputRef.current?.click()}>
              <ArrowDownToLine className="size-4" />
              <span>导入数据</span>
            </Button>
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onInspectRestoreBackup(entry)}
                      disabled={status.leaseRole === "follower"}
                    >
                      恢复
                    </Button>
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
    </>
  )
}
