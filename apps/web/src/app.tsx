import { AlertCircle, Bluetooth, Boxes, Cable, RefreshCw, Server, WandSparkles } from "lucide-react"
import React from "react"

import { type ApiClient, createApiClient, loadSetup } from "./api-client.js"
import { type BrowserPrintSource, materializeBrowserPreview } from "./browser-print-payload.js"
import {
  type BrowserPrinterSession,
  type BrowserPrintResult,
  connectBrowserPrinter,
  getSelectedBrowserPrinter,
  isBrowserPrintSupported,
  printPreviewArtifact,
  restoreBrowserPrinter,
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

function hasPrintTarget(
  printerId: string,
  browserPrinter: BrowserPrinterSession | null,
  serviceApiAvailable: boolean,
  browserDirectAvailable: boolean
): boolean {
  return (
    (serviceApiAvailable && printerId.length > 0) ||
    (browserDirectAvailable && browserPrinter !== null)
  )
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
  if (context.capabilities.serviceApiPrintPath === "available") {
    return "service-api live"
  }
  if (context.capabilities.serviceApiPrintPath === "mocked") {
    return "service-api mocked"
  }
  return `service-api ${context.capabilities.serviceApiPrintPath}`
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

function buildBrowserDirectPathLabel(context: AppContext, browserPrintSupported: boolean): string {
  if (context.capabilities.browserDirectPrintPath === "disabled") {
    return "browser-direct disabled"
  }
  if (!browserPrintSupported) {
    return "browser-direct unsupported"
  }
  return `browser-direct ${context.capabilities.browserDirectPrintPath}`
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
  const [serverPrinterSelectionMode, setServerPrinterSelectionMode] = React.useState<
    "none" | "auto" | "explicit"
  >("none")
  const [preferredPrinterName, setPreferredPrinterName] = React.useState("")
  const [preview, setPreview] = React.useState<PreviewResult | null>(null)
  const [previewPrintSource, setPreviewPrintSource] = React.useState<BrowserPrintSource | null>(
    null
  )
  const [previewImageOverrideUrl, setPreviewImageOverrideUrl] = React.useState<string | null>(null)
  const [browserPrinter, setBrowserPrinter] = React.useState<BrowserPrinterSession | null>(
    getSelectedBrowserPrinter()
  )
  const [printResult, setPrintResult] = React.useState<UiPrintResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const browserPrintSupported = React.useMemo(() => isBrowserPrintSupported(), [])
  const browserDirectConfigured = context.capabilities.browserDirectPrintPath !== "disabled"
  const browserDirectAvailable = browserDirectConfigured && browserPrintSupported
  const serviceApiLive = context.capabilities.serviceApiPrintPath === "available"
  const serviceApiUsable =
    context.capabilities.serviceApiPrintPath === "available" ||
    context.capabilities.serviceApiPrintPath === "mocked"

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
    const setup = serviceApiUsable
      ? await loadSetup(client, [], preferredPrinterNameRef.current)
      : {
          printers: [] as Printer[],
          selectedPrinter: null,
          selectedPrinterReason: "none" as const,
        }

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
    setPrinters(nextPrinters)
    setPrinterId(nextSelectedPrinter?.id ?? "")
    setServerPrinterSelectionMode(
      nextSelectedPrinter
        ? setup.selectedPrinterReason === "singleton"
          ? "auto"
          : "explicit"
        : "none"
    )
    if (setup.selectedPrinterReason === "singleton") {
      setPreferredPrinterName("")
    } else if (nextSelectedPrinter?.name) {
      setPreferredPrinterName(nextSelectedPrinter.name)
    } else if (nextPrinters.length === 0) {
      setPreferredPrinterName("")
    }

    return {
      templates: nextTemplates,
      printers: nextPrinters,
      selectedPrinter: nextSelectedPrinter,
    }
  }, [client, serviceApiUsable])

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

  React.useEffect(() => {
    if (!browserDirectAvailable || browserPrinter !== null) {
      return
    }

    let cancelled = false
    void restoreBrowserPrinter()
      .then((restoredPrinter) => {
        if (!cancelled && restoredPrinter) {
          setBrowserPrinter(restoredPrinter)
        }
      })
      .catch(() => {
        // Ignore silent restore failures; the user can still reconnect explicitly.
      })

    return () => {
      cancelled = true
    }
  }, [browserDirectAvailable, browserPrinter])

  React.useEffect(() => {
    if (!browserPrinter || serverPrinterSelectionMode !== "auto") {
      return
    }

    setPrinterId("")
    setServerPrinterSelectionMode("none")
    setPreferredPrinterName("")
  }, [browserPrinter, serverPrinterSelectionMode])

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
    const source = buildTemplateBrowserPrintSource()
    const result = await run("preview-template", () =>
      client.previewTemplate({ templateId, input, renderOptions })
    )

    if (result) {
      setPreview(result)
      setPreviewPrintSource(source)
      setPreviewImageOverrideUrl(null)
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
    setServerPrinterSelectionMode(nextPrinterId ? "explicit" : "none")
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

  function buildTemplateBrowserPrintSource(): BrowserPrintSource {
    return {
      kind: "template",
      templateId,
      input,
      renderOptions: {
        printWidthDots: 384,
        previewScale: 4,
        paperType: renderOptions.paperType,
        threshold: renderOptions.threshold,
        xOffsetDots: renderOptions.xOffsetDots,
      },
    }
  }

  function buildSafeTextBrowserPrintSource(): BrowserPrintSource {
    return {
      kind: "safe-text",
      text: safeText,
      title: "Safe Text Label",
      renderOptions: {
        printWidthDots: 384,
        previewScale: 4,
        paperType: "continuous",
        threshold: renderOptions.threshold,
        xOffsetDots: renderOptions.xOffsetDots,
      },
    }
  }

  async function refreshPreviewFromBrowserSource(source: BrowserPrintSource) {
    const materialized = await materializeBrowserPreview(source)
    setPreview({ artifact: materialized.artifact })
    setPreviewPrintSource(source)
    setPreviewImageOverrideUrl(materialized.dataUrl)
    return materialized
  }

  async function sendArtifactToSelectedPrinter(artifact: PreviewArtifact) {
    if (selectedPrinter && serviceApiUsable) {
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
      setError("先选择 service-api 打印机，或连接浏览器直连打印机，再提交打印。")
      return
    }

    if (!browserDirectAvailable) {
      setError("当前环境未开放浏览器直连打印链路，或浏览器不支持 Web Bluetooth。")
      return
    }

    const source =
      previewPrintSource ??
      (artifact.templateId === "safe-text-label"
        ? buildSafeTextBrowserPrintSource()
        : buildTemplateBrowserPrintSource())
    const result = await run("browser-print", () => printPreviewArtifact(browserPrinter, source))

    if (result) {
      setPrintResult(result)
    }
  }

  async function printTemplateDirectly() {
    if (
      !hasPrintTarget(
        selectedServerPrinterId,
        browserPrinter,
        serviceApiUsable,
        browserDirectAvailable
      )
    ) {
      setError("先选择 service-api 打印机，或连接浏览器直连打印机，再提交打印。")
      return
    }

    if (selectedPrinter && serviceApiUsable) {
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
      if (!browserDirectAvailable) {
        setError("当前环境未开放浏览器直连打印链路，或浏览器不支持 Web Bluetooth。")
        return
      }

      const result = await run("preview-and-print-template", async () => {
        const source = buildTemplateBrowserPrintSource()
        const nextPreview = await refreshPreviewFromBrowserSource(source)
        const print = await printPreviewArtifact(browserPrinter, source)

        return { preview: { artifact: nextPreview.artifact }, print }
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
    if (
      !hasPrintTarget(
        selectedServerPrinterId,
        browserPrinter,
        serviceApiUsable,
        browserDirectAvailable
      )
    ) {
      setError("先选择 service-api 打印机，或连接浏览器直连打印机，再提交打印。")
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

    if (selectedPrinter && serviceApiUsable) {
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
        if (!browserDirectAvailable) {
          throw new Error("当前环境未开放浏览器直连打印链路，或浏览器不支持 Web Bluetooth。")
        }

        const source = buildSafeTextBrowserPrintSource()
        const nextPreview = await refreshPreviewFromBrowserSource(source)
        const print = await printPreviewArtifact(browserPrinter, source)

        return { preview: { artifact: nextPreview.artifact }, print }
      }

      throw new Error("未找到可用打印目标。")
    })

    if (result) {
      setPreview(result.preview)
      setPrintResult(result.print)
    }
  }

  async function previewSafeText() {
    const source = buildSafeTextBrowserPrintSource()
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
      setPreviewPrintSource(source)
      setPreviewImageOverrideUrl(null)
      setPrintResult(null)
    }
  }

  async function printCurrentPreview() {
    if (
      !hasPrintTarget(
        selectedServerPrinterId,
        browserPrinter,
        serviceApiUsable,
        browserDirectAvailable
      )
    ) {
      setError("先选择 service-api 打印机，或连接浏览器直连打印机，再提交打印。")
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
                  产品正式提供两条打印链路：浏览器直连硬件与 service-api
                  连硬件。模板填充、单条安全文本、 预览产物与打印提交共用同一份 artifact
                  语义，但浏览器直连链路在浏览器内自洽完成渲染、编码与发包。
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
                  serviceApiLive
                    ? "当前环境开放 service-api print path，通过 /api 驱动服务程序与硬件。"
                    : context.capabilities.serviceApiPrintPath === "mocked"
                      ? "当前环境通过 mock API layer 复用 service-api 状态模型。"
                      : "当前环境未开放 service-api print path。"
                }
              />
              <StatCard
                icon={<Bluetooth className="size-4" />}
                title="Browser Direct"
                value={buildBrowserDirectPathLabel(context, browserPrintSupported)}
                description={
                  browserDirectConfigured
                    ? "支持的 secure-context 浏览器可在前端本地完成渲染、编码与 BLE 发包。"
                    : "浏览器直连链路已被产品开关关闭。"
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
                Browser Direct Print Path / Service API Print Path。所有 owner-facing demo 复用正式
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
                    ? browserDirectConfigured
                      ? "Browser direct print path 可直接参与本地渲染、编码与发包。"
                      : "Browser direct print path 已被开关关闭。"
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
                  service-api 打印机、浏览器直连打印机与渲染参数在这里统一控制。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <FieldBlock label="Service API 打印机" htmlFor="printer-select">
                  <Select value={printerId} onValueChange={rememberPrinterSelection}>
                    <SelectTrigger id="printer-select" aria-label="Service API 打印机">
                      <SelectValue
                        placeholder={
                          printers.length === 0 ? "当前模式没有 service-api 打印机" : "请选择打印机"
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
                    disabled={!browserDirectConfigured || !browserPrintSupported}
                  >
                    {browserPrinter ? "重新连接浏览器直连打印机" : "连接浏览器直连打印机"}
                  </BusyButton>
                  <div
                    className="rounded-lg border border-border/60 bg-muted/25 p-3"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">浏览器直连打印机</div>
                      <Badge variant={browserPrinter ? "secondary" : "outline"}>
                        {browserPrinter ? "已连接" : "未连接"}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground">
                      {browserPrinter?.name ?? "尚未选择设备"}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {browserDirectConfigured
                        ? browserPrintSupported
                          ? browserPrinter
                            ? `设备 ID ${browserPrinter.deviceId}`
                            : "连接成功后会在这里直接显示当前浏览器选中的蓝牙打印机。"
                          : "当前浏览器不支持 Web Bluetooth。"
                        : "浏览器直连打印链路已被产品开关关闭。"}
                    </p>
                  </div>
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
                      browserDirectConfigured
                        ? browserPrintSupported
                          ? browserPrinter
                            ? `设备 ID ${browserPrinter.deviceId}`
                            : "可选：用当前浏览器选择并连接真实蓝牙打印机。"
                          : "当前浏览器不支持 Web Bluetooth。"
                        : "浏览器直连打印链路已被产品开关关闭。"
                    }
                  />
                  <StatCard
                    icon={<Server className="size-4" />}
                    title="Service API 能力"
                    value={
                      selectedPrinter?.name ??
                      (context.capabilities.serviceApiPrintPath === "mocked"
                        ? "mock contract"
                        : context.capabilities.serviceApiPrintPath)
                    }
                    description={
                      selectedPrinter
                        ? `宽度 ${selectedPrinter.capabilities.printWidthDots} dots · 支持 ${selectedPrinter.capabilities.supportedPaperTypes.join(
                            " / "
                          )}`
                        : context.capabilities.serviceApiPrintPath === "mocked"
                          ? "Pages 与 mock shell 通过 capability gating 复用正式路由，不依赖真实 /api。"
                          : context.capabilities.serviceApiPrintPath === "disabled"
                            ? "当前环境未开放 service-api print path；浏览器直连链路可独立使用。"
                            : "需要先刷新并选中当前可见的 service-api 打印机；浏览器直连能力可并存使用。"
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
                    !hasPrintTarget(
                      selectedServerPrinterId,
                      browserPrinter,
                      serviceApiUsable,
                      browserDirectAvailable
                    )
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
                        disabled={
                          !hasPrintTarget(
                            selectedServerPrinterId,
                            browserPrinter,
                            serviceApiUsable,
                            browserDirectAvailable
                          )
                        }
                      >
                        预览后打印
                      </BusyButton>
                    </div>
                  </div>
                  <CardDescription>
                    模板预览和打印都产出同一份 artifact 语义；浏览器直连打印不再依赖 server packet
                    helper。
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
                        disabled={
                          !hasPrintTarget(
                            selectedServerPrinterId,
                            browserPrinter,
                            serviceApiUsable,
                            browserDirectAvailable
                          )
                        }
                      >
                        预览后打印
                      </BusyButton>
                    </div>
                  </div>
                  <CardDescription>
                    安全文本标签强制使用连续纸，用来验证双链路合同，尤其是浏览器纯前端直连打印链路。
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
                    `demo=false` 仍然走同一套页面与状态模型，只是双打印链路会通过 mock/capability
                    gate 明确表达。
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
                          src={previewImageOverrideUrl ?? client.previewImageUrl(activeArtifact)}
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
                    这里汇总双打印链路状态、capability gate 结果，以及最近一次打印返回。
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
                    value={`${buildBrowserDirectPathLabel(context, browserPrintSupported)} / ${buildServerPrintLabel(context)}`}
                    description={
                      browserPrintSupported
                        ? browserDirectConfigured
                          ? "Browser direct print path stays real in supported browsers."
                          : "Browser direct print path is disabled by product switch."
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
