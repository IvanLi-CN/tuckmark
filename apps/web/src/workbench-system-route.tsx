import { AlertCircle, CheckCircle2, RefreshCcw, ScanSearch } from "lucide-react"
import React from "react"

import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Button } from "./components/ui/button.js"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js"
import { SystemDataStorageCard } from "./system-data-storage-card.js"
import { ArchivedTemplateManagementCard, EmptyMini, RenderOptionsForm } from "./workbench-app.js"
import type { WorkbenchController } from "./workbench-controller.js"

export default function WorkbenchSystemRoute({
  controller,
  onRouteChunkReady,
}: {
  controller: WorkbenchController
  onRouteChunkReady?: () => void
}) {
  React.useEffect(() => {
    onRouteChunkReady?.()
  }, [onRouteChunkReady])

  return (
    <section className="tm-system">
      <div className="tm-system__grid">
        <SystemDataStorageCard
          busy={controller.dataDirectoryBusy}
          dialog={controller.dataDirectoryDialog}
          status={controller.dataDirectoryStatus}
          onCancelDialog={controller.cancelDataDirectoryDialog}
          onChooseDirectory={() => void controller.chooseDataDirectory()}
          onConfirmAttachment={(mode) => void controller.confirmDataDirectoryAttachment(mode)}
          onConfirmImport={() => void controller.confirmImportDataArchive()}
          onConfirmRestore={() => void controller.confirmRestoreBackup()}
          onCreateBackup={() => void controller.createManualDataBackup()}
          onExportArchive={() => void controller.exportDataArchive()}
          onInspectImportArchive={(file) => void controller.inspectImportDataArchive(file)}
          onInspectRestoreBackup={(entry) => void controller.inspectRestoreBackup(entry)}
          onRequestPermission={() => void controller.requestDataDirectoryPermission()}
          onSyncNow={() => void controller.syncDataDirectoryNow()}
          onTakeOverWrites={controller.takeOverDataDirectoryWrites}
        />

        <ArchivedTemplateManagementCard controller={controller} />

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">应用设置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <div className="tm-list-item">
              <span>模式</span>
              <strong>{controller.context.mode === "demo" ? "Demo" : "Runtime"}</strong>
            </div>
            <div className="tm-list-item">
              <span>运行面</span>
              <strong>
                {controller.context.surface === "server-http" ? "Server HTTP" : "Browser static"}
              </strong>
            </div>
            <div className="tm-list-item">
              <span>当前设备</span>
              <strong>
                {controller.selectedPrinter?.name ?? controller.browserPrinter?.name ?? "未选择"}
              </strong>
            </div>
          </CardContent>
        </Card>

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">默认打印参数</CardTitle>
          </CardHeader>
          <CardContent>
            <RenderOptionsForm controller={controller} onFocusRight={() => undefined} compact />
          </CardContent>
        </Card>

        <Card className="tm-panel">
          <CardHeader>
            <CardTitle as="h2">设备管理与探测</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button type="button" variant="outline" onClick={() => void controller.refreshSetup()}>
              <RefreshCcw className="size-4" />
              <span>刷新打印机列表</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void controller.probeSelectedPrinter()}
            >
              <ScanSearch className="size-4" />
              <span>探测当前设备</span>
            </Button>
            {controller.probeResult ? (
              <Alert variant={controller.probeResult.ok ? "default" : "destructive"}>
                {controller.probeResult.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4" />
                )}
                <AlertTitle>{controller.probeResult.stage}</AlertTitle>
                <AlertDescription>{controller.probeResult.message}</AlertDescription>
              </Alert>
            ) : (
              <EmptyMini text="尚未执行探测。" />
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
