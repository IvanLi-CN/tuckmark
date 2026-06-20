import {
  AlertCircle,
  Bluetooth,
  Boxes,
  Cable,
  Database,
  RefreshCw,
  Server,
  WandSparkles,
} from "lucide-react"
import React from "react"

import { type ApiClient, createApiClient, loadSetup } from "./api-client.js"
import {
  type BrowserPrinterSession,
  type BrowserPrintResult,
  connectBrowserPrinter,
  getSelectedBrowserPrinter,
  isBrowserPrintSupported,
  printPreviewArtifact,
} from "./browser-printer.js"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js"
import { Badge } from "./components/ui/badge.js"
import { Button } from "./components/ui/button.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js"
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
  buildInputFromTemplate,
  defaultRenderOptions,
  fallbackInputs,
  fallbackTemplates,
} from "./demo-data.js"
import { cn } from "./lib/utils.js"
import { resolveAppContext } from "./runtime.js"
import type {
  AppContext,
  ArtifactData,
  PreviewResult,
  Printer,
  PrintResult,
  RenderOptions,
  Template,
} from "./types.js"

type UiPrintResult = PrintResult | BrowserPrintResult

function summarizePrintResult(result: UiPrintResult | null): string {
  if (!result) {
    return "尚未打印。"
  }

  if ("message" in result) {
    return `${result.printer.name} · ${result.message}`
  }

  if (result.job) {
    return `打印任务 ${result.job.id} 已提交，状态 ${result.job.status}。`
  }

  if (result.id && result.status) {
    return `打印任务 ${result.id} 状态 ${result.status}。`
  }

  return "打印已完成。"
}

function sortPrinters(printers: Printer[]): Printer[] {
  return [...printers].sort((left, right) => {
    const leftRssi = left.rssi ?? Number.NEGATIVE_INFINITY
    const rightRssi = right.rssi ?? Number.NEGATIVE_INFINITY
    return rightRssi - leftRssi || left.id.localeCompare(right.id)
  })
}

function buildModeLabel(mode: AppContext["mode"]): string {
  return mode === "demo" ? "Demo mode" : "Runtime mode"
}

function buildSurfaceLabel(surface: AppContext["surface"]): string {
  return surface === "browser-static" ? "Browser static" : "Server HTTP"
}

function BusyButton({
  busy,
  busyKey,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  busy: string | null
  busyKey: string
}) {
  return (
    <Button className={className} disabled={props.disabled || busy !== null} {...props}>
      {busy === busyKey ? <RefreshCw className="size-4 animate-spin" /> : null}
      {children}
    </Button>
  )
}

function FieldBlock({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function StatCard({
  icon,
  title,
  value,
  description,
}: {
  icon: React.ReactNode
  title: string
  value: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/35 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="text-base font-semibold text-foreground">{value}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}

export type AppProps = {
  client?: ApiClient
  context?: AppContext
}

export function App({ client: providedClient, context: providedContext }: AppProps = {}) {
  const context = React.useMemo(
    () =>
      providedContext ?? resolveAppContext(import.meta.env as Record<string, string | undefined>),
    [providedContext]
  )
  const client = React.useMemo(
    () => providedClient ?? createApiClient(context),
    [context, providedClient]
  )

  const [templates, setTemplates] = React.useState<Template[]>(fallbackTemplates)
  const [templateId, setTemplateId] = React.useState(fallbackTemplates[0]?.id ?? "shipping-compact")
  const [input, setInput] = React.useState<Record<string, string>>(
    fallbackInputs["shipping-compact"]
  )
  const [safeText, setSafeText] = React.useState("Tuckmark\nPrint OK")
  const [renderOptions, setRenderOptions] = React.useState<RenderOptions>(defaultRenderOptions)
  const [printers, setPrinters] = React.useState<Printer[]>([])
  const [printerId, setPrinterId] = React.useState("")
  const [preferredPrinterName, setPreferredPrinterName] = React.useState("")
  const [preview, setPreview] = React.useState<PreviewResult | null>(null)
  const [artifactData, setArtifactData] = React.useState<ArtifactData | null>(null)
  const [browserPrinter, setBrowserPrinter] = React.useState<BrowserPrinterSession | null>(
    getSelectedBrowserPrinter()
  )
  const [printResult, setPrintResult] = React.useState<UiPrintResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const browserPrintSupported = React.useMemo(() => isBrowserPrintSupported(), [])
  const canUseBrowserPrinter = context.capabilities.browserPrint === "available"
  const hasServerPrinterFlow = context.capabilities.serverPrint === "available"

  const activeTemplate = React.useMemo(
    () => templates.find((template) => template.id === templateId) ?? templates[0],
    [templateId, templates]
  )

  const selectedPrinter = React.useMemo(
    () => printers.find((printer) => printer.id === printerId),
    [printerId, printers]
  )

  const preferredPrinterNameRef = React.useRef(preferredPrinterName)

  React.useEffect(() => {
    preferredPrinterNameRef.current = preferredPrinterName
  }, [preferredPrinterName])

  const refreshSetup = React.useCallback(async () => {
    const nextTemplates = await client.listTemplates()
    const setup = await loadSetup(client, [], preferredPrinterNameRef.current)

    if (nextTemplates.length > 0) {
      const fallbackTemplateId = nextTemplates[0]?.id ?? ""
      setTemplates(nextTemplates)
      setTemplateId((current) => {
        const next = nextTemplates.find((template) => template.id === current)
        return next?.id ?? fallbackTemplateId
      })
    }

    const nextPrinters = sortPrinters(setup.printers)
    const nextSelectedPrinter = setup.selectedPrinter
    const fallbackPrinterId = nextPrinters[0]?.id ?? ""
    setPrinters(nextPrinters)
    setPrinterId(nextSelectedPrinter?.id ?? (nextPrinters.length === 1 ? fallbackPrinterId : ""))
    if (nextSelectedPrinter?.name) {
      setPreferredPrinterName(nextSelectedPrinter.name)
    } else if (nextPrinters.length === 0) {
      setPreferredPrinterName("")
    }

    return {
      templates: nextTemplates,
      printers: nextPrinters,
      selectedPrinter: nextSelectedPrinter,
    }
  }, [client])

  React.useEffect(() => {
    void (async () => {
      try {
        await refreshSetup()
      } catch {
        setTemplates(fallbackTemplates)
      }
    })()
  }, [refreshSetup])

  React.useEffect(() => {
    setInput(buildInputFromTemplate(activeTemplate))
  }, [activeTemplate])

  async function run<T>(key: string, task: () => Promise<T>): Promise<T | undefined> {
    setBusy(key)
    setError(null)
    try {
      return await task()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function syncArtifactData(nextPreview: PreviewResult): Promise<void> {
    const data = await client.readArtifactData(nextPreview.artifact)
    setPreview(nextPreview)
    setArtifactData(data)
    setPrintResult(null)
  }

  async function previewTemplate() {
    const result = await run("preview-template", () =>
      client.previewTemplate({ templateId, input, renderOptions })
    )
    if (result) {
      await syncArtifactData(result)
    }
  }

  async function previewSafeText() {
    const result = await run("preview-safe-text", () =>
      client.previewSafeText({
        text: safeText,
        title: "Safe Text Label",
        renderOptions: {
          ...renderOptions,
          paperType: "continuous",
        },
      })
    )
    if (result) {
      await syncArtifactData(result)
    }
  }

  async function connectPhysicalPrinter() {
    if (!canUseBrowserPrinter) {
      setError("Demo mode 不会触发真实硬件连接。")
      return
    }
    const result = await run("connect-browser-printer", () => connectBrowserPrinter())
    if (result) {
      setBrowserPrinter(result)
    }
  }

  async function printThroughBrowser() {
    if (!browserPrinter) {
      setError("先连接当前浏览器中的打印机。")
      return
    }
    if (!preview || !artifactData) {
      setError("先生成一个预览，再提交打印。")
      return
    }
    const result = await run("browser-print", () =>
      printPreviewArtifact(browserPrinter, {
        id: preview.artifact.id,
        packets: artifactData.packets,
      })
    )
    if (result) {
      setPrintResult(result)
    }
  }

  async function printThroughServer(artifactId: string) {
    if (!selectedPrinter) {
      setError("先选择一个后端打印机。")
      return
    }
    const result = await run("server-print-artifact", () =>
      client.printArtifact({
        printerId: selectedPrinter.id,
        printerName: selectedPrinter.name,
        artifactId,
      })
    )
    if (result) {
      setPrintResult(result)
    }
  }

  async function printCurrentPreview() {
    if (!preview) {
      setError("先生成一个预览，再提交打印。")
      return
    }

    if (context.mode === "demo") {
      const result = await run("demo-print-artifact", () =>
        client.printArtifact({
          printerId: selectedPrinter?.id ?? browserPrinter?.deviceId ?? "demo-printer",
          printerName: selectedPrinter?.name ?? browserPrinter?.name ?? "Demo printer",
          artifactId: preview.artifact.id,
        })
      )
      if (result) {
        setPrintResult(result)
      }
      return
    }

    if (hasServerPrinterFlow && selectedPrinter) {
      await printThroughServer(preview.artifact.id)
      return
    }

    await printThroughBrowser()
  }

  async function printTemplateDirectly() {
    if (context.mode === "demo") {
      const result = await run("demo-preview-and-print-template", () =>
        client.printTemplate({
          printerId: selectedPrinter?.id ?? browserPrinter?.deviceId ?? "demo-printer",
          printerName: selectedPrinter?.name ?? browserPrinter?.name ?? "Demo printer",
          templateId,
          input,
          renderOptions,
        })
      )
      if (result?.preview) {
        await syncArtifactData(result.preview)
      }
      if (result) {
        setPrintResult(result)
      }
      return
    }

    if (hasServerPrinterFlow && selectedPrinter) {
      const result = await run("server-preview-and-print-template", () =>
        client.printTemplate({
          printerId: selectedPrinter.id,
          printerName: selectedPrinter.name,
          templateId,
          input,
          renderOptions,
        })
      )
      if (result?.preview) {
        await syncArtifactData(result.preview)
      }
      if (result) {
        setPrintResult(result)
      }
      return
    }

    const result = await run("preview-and-print-template", async () => {
      const nextPreview = await client.previewTemplate({ templateId, input, renderOptions })
      const nextData = await client.readArtifactData(nextPreview.artifact)
      if (!browserPrinter) {
        throw new Error("先连接当前浏览器中的打印机。")
      }
      const print = await printPreviewArtifact(browserPrinter, {
        id: nextPreview.artifact.id,
        packets: nextData.packets,
      })
      return { preview: nextPreview, data: nextData, print }
    })

    if (result) {
      setPreview(result.preview)
      setArtifactData(result.data)
      setPrintResult(result.print)
    }
  }

  async function printSafeTextDirectly() {
    const safeTextPayload = {
      text: safeText,
      title: "Safe Text Label",
      renderOptions: {
        ...renderOptions,
        paperType: "continuous" as const,
      },
    }

    if (context.mode === "demo") {
      const result = await run("demo-preview-and-print-safe-text", () =>
        client.printSafeText({
          printerId: selectedPrinter?.id ?? browserPrinter?.deviceId ?? "demo-printer",
          printerName: selectedPrinter?.name ?? browserPrinter?.name ?? "Demo printer",
          ...safeTextPayload,
        })
      )
      if (result?.preview) {
        await syncArtifactData(result.preview)
      }
      if (result) {
        setPrintResult(result)
      }
      return
    }

    if (hasServerPrinterFlow && selectedPrinter) {
      const result = await run("server-preview-and-print-safe-text", () =>
        client.printSafeText({
          printerId: selectedPrinter.id,
          printerName: selectedPrinter.name,
          ...safeTextPayload,
        })
      )
      if (result?.preview) {
        await syncArtifactData(result.preview)
      }
      if (result) {
        setPrintResult(result)
      }
      return
    }

    const result = await run("preview-and-print-safe-text", async () => {
      const nextPreview = await client.previewSafeText(safeTextPayload)
      const nextData = await client.readArtifactData(nextPreview.artifact)
      if (!browserPrinter) {
        throw new Error("先连接当前浏览器中的打印机。")
      }
      const print = await printPreviewArtifact(browserPrinter, {
        id: nextPreview.artifact.id,
        packets: nextData.packets,
      })
      return { preview: nextPreview, data: nextData, print }
    })

    if (result) {
      setPreview(result.preview)
      setArtifactData(result.data)
      setPrintResult(result.print)
    }
  }

  const activeArtifact = preview?.artifact ?? null
  const previewSrc =
    artifactData?.preview.kind === "url"
      ? artifactData.preview.url
      : artifactData?.preview.kind === "data-url"
        ? artifactData.preview.dataUrl
        : null

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(178,106,58,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(70,111,140,0.14),transparent_28%),linear-gradient(180deg,#fcfaf7_0%,#f3eee7_100%)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
          <Card className="overflow-hidden border-border/60 bg-card/92 shadow-[0_18px_50px_rgba(66,46,31,0.08)]">
            <CardHeader className="gap-4 border-b border-border/50 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                  Tuckmark
                </Badge>
                <Badge variant="outline">base {context.basePath || "/"}</Badge>
                <Badge variant="secondary">{buildSurfaceLabel(context.surface)}</Badge>
                <Badge variant={context.mode === "demo" ? "default" : "outline"}>
                  {buildModeLabel(context.mode)}
                </Badge>
              </div>
              <div className="grid gap-3">
                <CardTitle as="h1" className="max-w-3xl text-3xl sm:text-4xl">
                  单标签打印主链路
                </CardTitle>
                <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                  模板填充、单条安全文本、预览产物与打印提交全部共用同一份 artifact。静态
                  browser-runtime 走本地渲染与本地协议包生成；demo mode 继续通过 Mock API
                  层返回成功仿真。
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 py-6 md:grid-cols-3">
              <StatCard
                icon={<Boxes className="size-4" />}
                title="Surface"
                value={buildSurfaceLabel(context.surface)}
                description="server-http 与 browser-static 使用同一份正式页面和状态模型。"
              />
              <StatCard
                icon={<Server className="size-4" />}
                title="Mode"
                value={buildModeLabel(context.mode)}
                description={
                  context.mode === "demo"
                    ? "Demo mode 会保留正式表单与路由，但所有硬件动作都返回带延迟的成功仿真。"
                    : "Runtime mode 使用真实 runtime surface：server-http 走 /api，browser-static 走浏览器本地链路。"
                }
              />
              <StatCard
                icon={<Bluetooth className="size-4" />}
                title="Browser BLE"
                value={
                  browserPrintSupported
                    ? canUseBrowserPrinter
                      ? "available"
                      : "disabled"
                    : "unsupported"
                }
                description={
                  context.mode === "demo"
                    ? "Demo mode 禁用真实硬件调用，只保留产品级打印动作仿真。"
                    : context.surface === "browser-static"
                      ? "静态 runtime 在支持的浏览器中可连接并打印到当前浏览器打印机。"
                      : "server-http surface 同时保留 /api 打印与浏览器直连路径。"
                }
              />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-zinc-950 text-zinc-50 shadow-[0_18px_50px_rgba(16,16,18,0.28)]">
            <CardHeader className="gap-3 border-b border-white/10 pb-5">
              <Badge variant="outline" className="w-fit border-white/20 bg-white/5 text-zinc-100">
                Delivery contract
              </Badge>
              <CardTitle className="text-xl text-zinc-50">
                Preview shares the print artifact
              </CardTitle>
              <CardDescription className="text-sm leading-7 text-zinc-300">
                Runtime 页面只切换 surface 与 capability，不再通过 hostname/origin
                猜测模式。静态构建使用相对 public base，适配 GitHub Pages 自定义域名根路径部署。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 py-6 text-sm text-zinc-200">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="font-medium">Print target</div>
                <p className="mt-2 leading-6 text-zinc-300">
                  {selectedPrinter?.name ??
                    browserPrinter?.name ??
                    (context.mode === "demo" ? "Demo printer" : "尚未选择")}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="font-medium">Artifact source</div>
                <p className="mt-2 leading-6 text-zinc-300">
                  {context.surface === "browser-static"
                    ? "预览 PNG 与协议包都由浏览器本地生成，artifact 优先保存在 IndexedDB，失败时回退内存。"
                    : "server-http 由 /api 负责预览 artifact 与协议包；UI 统一按数据型 artifact seam 消费。"}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="grid gap-6">
            <Card className="border-border/60 bg-card/94">
              <CardHeader>
                <CardTitle className="text-lg">打印配置</CardTitle>
                <CardDescription>surface、浏览器打印机与渲染参数在这里统一控制。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                {hasServerPrinterFlow ? (
                  <FieldBlock label="后端探测打印机" htmlFor="printer-select">
                    <Select value={printerId} onValueChange={setPrinterId}>
                      <SelectTrigger id="printer-select" aria-label="后端探测打印机">
                        <SelectValue
                          placeholder={
                            printers.length === 0 ? "当前没有后端打印机" : "请选择打印机"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {printers.length !== 1 ? (
                          <SelectItem value="">请选择打印机</SelectItem>
                        ) : null}
                        {printers.map((printer) => (
                          <SelectItem key={printer.id} value={printer.id}>
                            {printer.name ?? printer.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldBlock>
                ) : null}

                <div className="flex flex-col gap-3">
                  <BusyButton
                    type="button"
                    variant="secondary"
                    busy={busy}
                    busyKey="refresh-setup"
                    onClick={() => void run("refresh-setup", refreshSetup)}
                  >
                    {context.mode === "demo" ? "刷新模板与仿真状态" : "刷新模板与打印机"}
                  </BusyButton>
                  <BusyButton
                    type="button"
                    variant="outline"
                    busy={busy}
                    busyKey="connect-browser-printer"
                    onClick={connectPhysicalPrinter}
                    disabled={!browserPrintSupported || !canUseBrowserPrinter}
                  >
                    连接当前浏览器打印机
                  </BusyButton>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  <FieldBlock label="纸型" htmlFor="paper-type">
                    <Select
                      value={renderOptions.paperType}
                      onValueChange={(value) =>
                        setRenderOptions((current) => ({
                          ...current,
                          paperType: value as RenderOptions["paperType"],
                        }))
                      }
                    >
                      <SelectTrigger id="paper-type" aria-label="纸型">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="continuous">连续纸</SelectItem>
                        <SelectItem value="gap">间隔纸</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldBlock>

                  <FieldBlock label="Threshold" htmlFor="threshold-input">
                    <Input
                      id="threshold-input"
                      type="number"
                      value={renderOptions.threshold}
                      onChange={(event) =>
                        setRenderOptions((current) => ({
                          ...current,
                          threshold: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </FieldBlock>

                  <FieldBlock label="X Offset" htmlFor="x-offset-input">
                    <Input
                      id="x-offset-input"
                      type="number"
                      value={renderOptions.xOffsetDots}
                      onChange={(event) =>
                        setRenderOptions((current) => ({
                          ...current,
                          xOffsetDots: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </FieldBlock>
                </div>

                <div className="grid gap-3">
                  <StatCard
                    icon={<Bluetooth className="size-4" />}
                    title="当前浏览器打印机"
                    value={browserPrinter?.name ?? "未连接"}
                    description={
                      context.mode === "demo"
                        ? "Demo mode 不触发真实 Web Bluetooth / Serial 等硬件能力。"
                        : browserPrintSupported
                          ? browserPrinter
                            ? `设备 ID ${browserPrinter.deviceId}`
                            : "可选：用当前浏览器选择并连接真实蓝牙打印机。"
                          : "当前浏览器不支持 Web Bluetooth。"
                    }
                  />
                  <StatCard
                    icon={<Server className="size-4" />}
                    title="Server capability"
                    value={hasServerPrinterFlow ? (selectedPrinter?.name ?? "未选择") : "disabled"}
                    description={
                      hasServerPrinterFlow
                        ? selectedPrinter
                          ? `宽度 ${selectedPrinter.capabilities.printWidthDots} dots · 支持 ${selectedPrinter.capabilities.supportedPaperTypes.join(
                              " / "
                            )}`
                          : "需要先刷新并选中当前可见的后端打印机。"
                        : "browser-static surface 不显示服务器打印机列表；demo mode 也不会暴露真实 server-print。"
                    }
                  />
                </div>

                <BusyButton
                  type="button"
                  busy={busy}
                  busyKey="server-print-artifact"
                  onClick={printCurrentPreview}
                  disabled={!preview?.artifact?.id && context.mode !== "demo"}
                >
                  打印当前预览
                </BusyButton>
              </CardContent>
            </Card>
          </aside>

          <main className="grid gap-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border/60 bg-card/94">
                <CardHeader className="gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <Badge variant="outline" className="w-fit">
                        Template
                      </Badge>
                      <CardTitle className="text-lg">模板标签</CardTitle>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <BusyButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        busy={busy}
                        busyKey="preview-template"
                        onClick={previewTemplate}
                      >
                        生成预览
                      </BusyButton>
                      <BusyButton
                        type="button"
                        size="sm"
                        busy={busy}
                        busyKey="server-preview-and-print-template"
                        onClick={printTemplateDirectly}
                      >
                        预览后打印
                      </BusyButton>
                    </div>
                  </div>
                  <CardDescription>
                    模板预览和打印都产出同一份 artifact，不额外分叉渲染路径。
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <FieldBlock label="模板" htmlFor="template-select">
                    <Select value={templateId} onValueChange={setTemplateId}>
                      <SelectTrigger id="template-select" aria-label="模板">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldBlock>

                  {activeTemplate ? (
                    <p className="text-sm leading-6 text-muted-foreground">
                      {activeTemplate.description}
                    </p>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    {Object.entries(input).map(([key, value]) => {
                      const field = activeTemplate?.fields.find((item) => item.key === key)
                      const controlId = `field-${key}`
                      return (
                        <div
                          key={key}
                          className={cn(
                            "grid gap-2",
                            field?.multiline ? "md:col-span-2" : undefined
                          )}
                        >
                          <Label htmlFor={controlId}>{field?.label ?? key}</Label>
                          <Textarea
                            id={controlId}
                            rows={field?.multiline ? 3 : 1}
                            className={cn(!field?.multiline && "min-h-10 resize-none")}
                            value={value}
                            onChange={(event) =>
                              setInput((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/94">
                <CardHeader className="gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <Badge variant="outline" className="w-fit">
                        Safe text
                      </Badge>
                      <CardTitle className="text-lg">单条安全文本</CardTitle>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <BusyButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        busy={busy}
                        busyKey="preview-safe-text"
                        onClick={previewSafeText}
                      >
                        生成预览
                      </BusyButton>
                      <BusyButton
                        type="button"
                        size="sm"
                        busy={busy}
                        busyKey="server-preview-and-print-safe-text"
                        onClick={printSafeTextDirectly}
                      >
                        预览后打印
                      </BusyButton>
                    </div>
                  </div>
                  <CardDescription>
                    安全文本标签强制使用连续纸，用来验证 artifact 持久化与打印提交 seam。
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <FieldBlock label="文本内容" htmlFor="safe-text">
                    <Textarea
                      id="safe-text"
                      rows={7}
                      value={safeText}
                      onChange={(event) => setSafeText(event.target.value)}
                    />
                  </FieldBlock>

                  <div className="rounded-lg border border-dashed border-border bg-muted/25 p-4 text-sm leading-6 text-muted-foreground">
                    `?demo=true` 会进入 demo
                    mode：刷新、预览、打印都返回带合理耗时的成功仿真，但仍保持正式页面和表单结构。
                  </div>
                </CardContent>
              </Card>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="mt-0.5 size-4" />
                <div>
                  <AlertTitle>打印链路返回错误</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </div>
              </Alert>
            ) : null}

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_380px]">
              <Card className="border-border/60 bg-card/94">
                <CardHeader className="gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <Badge variant="outline" className="w-fit">
                        Artifact
                      </Badge>
                      <CardTitle className="text-lg">当前预览</CardTitle>
                    </div>
                    <Badge variant={activeArtifact ? "default" : "outline"}>
                      {activeArtifact ? activeArtifact.id.slice(0, 8) : "empty"}
                    </Badge>
                  </div>
                  <CardDescription>
                    预览图、打印提交和 artifact metadata 始终绑定在同一份产物上。
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5">
                  {activeArtifact && previewSrc ? (
                    <>
                      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
                        <img
                          src={previewSrc}
                          alt="preview artifact"
                          className="block h-auto w-full"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <StatCard
                          icon={<WandSparkles className="size-4" />}
                          title="Template"
                          value={activeArtifact.templateId ?? "ad-hoc"}
                          description="artifact source identity"
                        />
                        <StatCard
                          icon={<Boxes className="size-4" />}
                          title="Size"
                          value={`${activeArtifact.width} × ${activeArtifact.height}`}
                          description="raster dimensions"
                        />
                        <StatCard
                          icon={<Cable className="size-4" />}
                          title="Paper"
                          value={activeArtifact.renderOptions.paperType}
                          description="render option contract"
                        />
                        <StatCard
                          icon={<RefreshCw className="size-4" />}
                          title="Created"
                          value={new Date(activeArtifact.createdAt).toLocaleString()}
                          description="artifact timestamp"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm leading-7 text-muted-foreground">
                      先生成一个模板预览或安全文本预览，artifact 面板会显示同一份可打印产物。
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/94">
                <CardHeader>
                  <CardTitle className="text-lg">Artifact seam</CardTitle>
                  <CardDescription>
                    UI 只读取 preview source 与 packet data，不再依赖 HTTP-only URL helper。
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <StatCard
                    icon={<Database className="size-4" />}
                    title="Preview source"
                    value={artifactData?.preview.kind ?? "empty"}
                    description={
                      artifactData?.preview.kind === "url"
                        ? "server-http 通过 /api 暴露 PNG URL。"
                        : artifactData?.preview.kind === "data-url"
                          ? "browser-static 与 demo 直接读取浏览器本地 data URL。"
                          : "尚未生成 artifact。"
                    }
                  />
                  <StatCard
                    icon={<Cable className="size-4" />}
                    title="Packets"
                    value={artifactData ? `${artifactData.packets.packetCount} packets` : "empty"}
                    description={
                      artifactData
                        ? `${artifactData.packets.totalBytes} bytes · 统一由 artifact data seam 交给 server-print 或 browser BLE。`
                        : "生成预览后这里会显示协议包信息。"
                    }
                  />
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                    {summarizePrintResult(printResult)}
                  </div>
                </CardContent>
              </Card>
            </section>
          </main>
        </section>
      </div>
    </div>
  )
}
