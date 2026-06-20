import { AlertCircle, Bluetooth, Boxes, Cable, RefreshCw, Server, WandSparkles } from "lucide-react"
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
  PreviewArtifact,
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

function hasPrintTarget(printerId: string, browserPrinter: BrowserPrinterSession | null): boolean {
  return printerId.length > 0 || browserPrinter !== null
}

function isPrinterUnavailableError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.includes("Printer is no longer available")
}

function buildModeLabel(mode: AppContext["mode"]): string {
  if (mode === "demo-seeded") {
    return "Pages demo"
  }
  if (mode === "mock-shell") {
    return "Mock shell"
  }
  return "Runtime"
}

function buildServerPrintLabel(context: AppContext): string {
  return context.capabilities.serverPrint === "available"
    ? "server print live"
    : "server print mocked"
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
  const [browserPrinter, setBrowserPrinter] = React.useState<BrowserPrinterSession | null>(
    getSelectedBrowserPrinter()
  )
  const [printResult, setPrintResult] = React.useState<UiPrintResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const browserPrintSupported = React.useMemo(() => isBrowserPrintSupported(), [])
  const canUseBrowserPrintPath = context.capabilities.packetsSource === "http"

  const activeTemplate = React.useMemo(
    () => templates.find((template) => template.id === templateId) ?? templates[0],
    [templateId, templates]
  )

  const selectedPrinter = React.useMemo(
    () => printers.find((printer) => printer.id === printerId),
    [printerId, printers]
  )
  const selectedServerPrinterId = selectedPrinter?.id ?? ""
  const printerIdRef = React.useRef(printerId)
  const preferredPrinterNameRef = React.useRef(preferredPrinterName)

  React.useEffect(() => {
    printerIdRef.current = printerId
  }, [printerId])

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

  async function previewTemplate() {
    const result = await run("preview-template", () =>
      client.previewTemplate({ templateId, input, renderOptions })
    )

    if (result) {
      setPreview(result)
      setPrintResult(null)
    }
  }

  async function connectPhysicalPrinter() {
    const result = await run("connect-browser-printer", () => connectBrowserPrinter())
    if (result) {
      setBrowserPrinter(result)
    }
  }

  function rememberPrinterSelection(nextPrinterId: string) {
    setPrinterId(nextPrinterId)
    const nextPrinter = printers.find((printer) => printer.id === nextPrinterId)
    if (nextPrinter?.name) {
      setPreferredPrinterName(nextPrinter.name)
      return
    }

    if (!nextPrinterId) {
      setPreferredPrinterName("")
    }
  }

  async function postServerPrintWithRecovery<T>(
    key: string,
    printer: Printer,
    task: (resolvedPrinter: Printer) => Promise<T>
  ): Promise<T | undefined> {
    return run(key, async () => {
      try {
        return await task(printer)
      } catch (cause) {
        if (!printer.name || !isPrinterUnavailableError(cause)) {
          throw cause
        }

        const setup = await refreshSetup()
        const reboundPrinter = setup.printers.find((item) => item.name === printer.name)
        if (!reboundPrinter) {
          throw cause
        }

        return task(reboundPrinter)
      }
    })
  }

  async function sendArtifactToSelectedPrinter(artifact: PreviewArtifact) {
    if (selectedPrinter) {
      const result = await postServerPrintWithRecovery(
        "server-print-artifact",
        selectedPrinter,
        (printer) =>
          client.printArtifact({
            printerId: printer.id,
            printerName: printer.name,
            artifactId: artifact.id,
          })
      )

      if (result) {
        setPrintResult(result)
      }
      return
    }

    if (!browserPrinter) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。")
      return
    }

    if (!canUseBrowserPrintPath) {
      setError(
        "当前模式保留浏览器蓝牙连接能力，但 artifact packet 生成依赖服务端，已通过 capability gate 禁止直接打印。"
      )
      return
    }

    const result = await run("browser-print", () =>
      printPreviewArtifact(browserPrinter, {
        id: artifact.id,
        pngUrl: client.previewImageUrl(artifact),
        packetsUrl: client.artifactPacketsUrl(artifact.id),
        renderOptions: artifact.renderOptions,
      })
    )

    if (result) {
      setPrintResult(result)
    }
  }

  async function printTemplateDirectly() {
    if (!hasPrintTarget(selectedServerPrinterId, browserPrinter)) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。")
      return
    }

    if (selectedPrinter) {
      const result = await postServerPrintWithRecovery(
        "server-preview-and-print-template",
        selectedPrinter,
        (printer) =>
          client.printTemplate({
            printerId: printer.id,
            printerName: printer.name,
            templateId,
            input,
            renderOptions,
          })
      )

      if (result) {
        if (result.preview) {
          setPreview(result.preview)
        }
        setPrintResult(result)
      }
      return
    }

    if (browserPrinter) {
      if (!canUseBrowserPrintPath) {
        setError(
          "当前模式保留浏览器蓝牙连接能力，但不提供服务端 packet 生成，因此只能演示连接，不能直接打印。"
        )
        return
      }

      const result = await run("preview-and-print-template", async () => {
        const nextPreview = await client.previewTemplate({ templateId, input, renderOptions })
        const print = await printPreviewArtifact(browserPrinter, {
          id: nextPreview.artifact.id,
          pngUrl: client.previewImageUrl(nextPreview.artifact),
          packetsUrl: client.artifactPacketsUrl(nextPreview.artifact.id),
          renderOptions: nextPreview.artifact.renderOptions,
        })

        return { preview: nextPreview, print }
      })

      if (result) {
        setPreview(result.preview)
        setPrintResult(result.print)
      }
      return
    }

    setError("未找到可用打印目标。")
  }

  async function printSafeTextDirectly() {
    if (!hasPrintTarget(selectedServerPrinterId, browserPrinter)) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。")
      return
    }

    const safeTextPayload = {
      text: safeText,
      title: "Safe Text Label",
      renderOptions: {
        ...renderOptions,
        paperType: "continuous" as const,
      },
    }

    if (selectedPrinter) {
      const result = await postServerPrintWithRecovery(
        "server-preview-and-print-safe-text",
        selectedPrinter,
        (printer) =>
          client.printSafeText({
            printerId: printer.id,
            printerName: printer.name,
            ...safeTextPayload,
          })
      )

      if (result) {
        if ("preview" in result && result.preview) {
          setPreview(result.preview)
        }
        setPrintResult(result)
      }
      return
    }

    const result = await run("preview-and-print-safe-text", async () => {
      if (browserPrinter) {
        if (!canUseBrowserPrintPath) {
          throw new Error(
            "当前模式不提供服务端 packet 生成，因此浏览器蓝牙打印被 capability gate 禁用。"
          )
        }

        const nextPreview = await client.previewSafeText(safeTextPayload)
        const print = await printPreviewArtifact(browserPrinter, {
          id: nextPreview.artifact.id,
          pngUrl: client.previewImageUrl(nextPreview.artifact),
          packetsUrl: client.artifactPacketsUrl(nextPreview.artifact.id),
          renderOptions: nextPreview.artifact.renderOptions,
        })

        return { preview: nextPreview, print }
      }

      throw new Error("未找到可用打印目标。")
    })

    if (result) {
      setPreview(result.preview)
      setPrintResult(result.print)
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
      setPreview(result)
      setPrintResult(null)
    }
  }

  async function printCurrentPreview() {
    if (!hasPrintTarget(selectedServerPrinterId, browserPrinter)) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。")
      return
    }

    if (!preview?.artifact.id) {
      setError("先生成一个预览，再提交打印。")
      return
    }

    await sendArtifactToSelectedPrinter(preview.artifact)
  }

  const activeArtifact = preview?.artifact ?? null

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
                <Badge variant="secondary">{buildModeLabel(context.mode)}</Badge>
              </div>
              <div className="grid gap-3">
                <CardTitle as="h1" className="max-w-3xl text-3xl sm:text-4xl">
                  单标签打印主链路
                </CardTitle>
                <CardDescription className="max-w-3xl text-base leading-7 text-muted-foreground">
                  模板填充、单条安全文本、预览产物与打印提交全部共用同一份 artifact。Pages demo 和
                  mock shell 只切换 API contract，不复制页面。
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 py-6 md:grid-cols-3">
              <StatCard
                icon={<Boxes className="size-4" />}
                title="Surface"
                value={buildModeLabel(context.mode)}
                description="正式路由与正式组件树在 runtime、Pages demo、mock shell 之间保持一致。"
              />
              <StatCard
                icon={<Server className="size-4" />}
                title="Server Contract"
                value={buildServerPrintLabel(context)}
                description={
                  context.capabilities.serverPrint === "available"
                    ? "当前环境直接走真实 /api 与后端打印能力。"
                    : "当前环境通过 mock API layer 复用正式状态模型。"
                }
              />
              <StatCard
                icon={<Bluetooth className="size-4" />}
                title="Browser BLE"
                value={browserPrintSupported ? "available" : "unsupported"}
                description={
                  canUseBrowserPrintPath
                    ? "支持时可保留真实浏览器蓝牙连接与 packet 打印链路。"
                    : "当前只保留真实连接能力，打印提交受 capability gate 限制。"
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
                Server Render → Server Print / Browser BLE Print。所有 owner-facing demo 复用正式
                app surface，不额外维护副本。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 py-6 text-sm text-zinc-200">
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="font-medium">Print target</div>
                <p className="mt-2 leading-6 text-zinc-300">
                  {selectedPrinter?.name ?? browserPrinter?.name ?? "尚未选择"}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="font-medium">Capability gate</div>
                <p className="mt-2 leading-6 text-zinc-300">
                  {browserPrintSupported
                    ? canUseBrowserPrintPath
                      ? "Browser BLE 可直接参与 artifact packet 提交。"
                      : "Browser BLE 只保留连接示意，packet 生成仍受服务端能力约束。"
                    : "当前浏览器不支持 Web Bluetooth。"}
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
                <CardDescription>
                  后端打印机、浏览器蓝牙打印机与渲染参数在这里统一控制。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <FieldBlock label="后端探测打印机" htmlFor="printer-select">
                  <Select value={printerId} onValueChange={rememberPrinterSelection}>
                    <SelectTrigger id="printer-select" aria-label="后端探测打印机">
                      <SelectValue
                        placeholder={
                          printers.length === 0 ? "当前模式没有后端打印机" : "请选择打印机"
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

                <div className="flex flex-col gap-3">
                  <BusyButton
                    type="button"
                    variant="secondary"
                    busy={busy}
                    busyKey="refresh-setup"
                    onClick={() => void run("refresh-setup", refreshSetup)}
                  >
                    刷新模板与打印机
                  </BusyButton>
                  <BusyButton
                    type="button"
                    variant="outline"
                    busy={busy}
                    busyKey="connect-browser-printer"
                    onClick={connectPhysicalPrinter}
                    disabled={!browserPrintSupported}
                  >
                    连接浏览器打印机
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
                    title="浏览器实体打印机"
                    value={browserPrinter?.name ?? "未连接"}
                    description={
                      browserPrintSupported
                        ? browserPrinter
                          ? `设备 ID ${browserPrinter.deviceId}`
                          : "可选：用当前浏览器选择并连接真实蓝牙打印机。"
                        : "当前浏览器不支持 Web Bluetooth。"
                    }
                  />
                  <StatCard
                    icon={<Server className="size-4" />}
                    title="后端探测能力"
                    value={
                      selectedPrinter?.name ??
                      (context.capabilities.serverPrint === "mocked" ? "mock contract" : "未选择")
                    }
                    description={
                      selectedPrinter
                        ? `宽度 ${selectedPrinter.capabilities.printWidthDots} dots · 支持 ${selectedPrinter.capabilities.supportedPaperTypes.join(
                            " / "
                          )}`
                        : context.capabilities.serverPrint === "mocked"
                          ? "Pages 与 mock shell 通过 capability gating 复用正式路由，不依赖真实 /api。"
                          : "需要先刷新并选中当前可见的后端打印机；浏览器直连能力可并存使用。"
                    }
                  />
                </div>

                <BusyButton
                  type="button"
                  busy={busy}
                  busyKey="server-print-artifact"
                  onClick={printCurrentPreview}
                  disabled={
                    !preview?.artifact?.id ||
                    !hasPrintTarget(selectedServerPrinterId, browserPrinter)
                  }
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
                        disabled={!hasPrintTarget(selectedServerPrinterId, browserPrinter)}
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
                        disabled={!hasPrintTarget(selectedServerPrinterId, browserPrinter)}
                      >
                        预览后打印
                      </BusyButton>
                    </div>
                  </div>
                  <CardDescription>
                    安全文本标签强制使用连续纸，用来验证服务端渲染与浏览器蓝牙打印链路。
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
                    `demo=false` 仍然走同一套页面与状态模型，只是 server-only 能力会通过
                    mock/capability gate 明确表达。
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
                  {activeArtifact ? (
                    <>
                      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
                        <img
                          src={client.previewImageUrl(activeArtifact)}
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
                    <div className="rounded-xl border border-dashed border-border bg-muted/25 px-5 py-10 text-center text-sm leading-7 text-muted-foreground">
                      先生成一个模板预览或安全文本预览，再检查产物并提交打印。
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/94">
                <CardHeader className="gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-1">
                      <Badge variant="outline" className="w-fit">
                        Print job
                      </Badge>
                      <CardTitle className="text-lg">打印状态</CardTitle>
                    </div>
                    <Badge variant={busy ? "secondary" : "outline"}>{busy ?? "idle"}</Badge>
                  </div>
                  <CardDescription>
                    这里汇总主链路状态、capability gate 结果，以及最近一次打印返回。
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="rounded-lg border border-border/70 bg-muted/35 p-4 text-sm leading-7 text-foreground">
                    {summarizePrintResult(printResult)}
                  </div>
                  <StatCard
                    icon={<Server className="size-4" />}
                    title="Mode"
                    value={buildModeLabel(context.mode)}
                    description={
                      context.mode === "runtime"
                        ? "真实 /api contract"
                        : "Mock API layer over the formal app surface"
                    }
                  />
                  <StatCard
                    icon={<Bluetooth className="size-4" />}
                    title="Capability gate"
                    value={buildServerPrintLabel(context)}
                    description={
                      browserPrintSupported
                        ? canUseBrowserPrintPath
                          ? "Web Bluetooth path can stay real in supported browsers."
                          : "Web Bluetooth connect stays real, but print submission is gated without packet generation."
                        : "Browser BLE unavailable in this browser."
                    }
                  />
                  {printResult ? (
                    <pre className="overflow-auto rounded-lg border border-border bg-zinc-950 p-4 text-xs leading-6 text-zinc-100">
                      {JSON.stringify(printResult, null, 2)}
                    </pre>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          </main>
        </section>
      </div>
    </div>
  )
}
