import React from "react"

import { type ApiClient, createApiClient, loadSetup } from "./api-client.js"
import { type BrowserPrintSource, materializeBrowserArtifactData } from "./browser-print-payload.js"
import {
  type BrowserPrinterSession,
  type BrowserPrintResult,
  connectBrowserPrinter,
  getSelectedBrowserPrinter,
  isBrowserPrintSupported,
  printPreviewArtifact,
  restoreBrowserPrinter,
} from "./browser-printer.js"
import { buildInputFromTemplate, defaultRenderOptions, fallbackTemplates } from "./demo-data.js"
import {
  loadRecentActivity,
  type RecentActivityState,
  recordRecentPrint,
  recordRecentTemplate,
} from "./lib/recent-activity.js"
import { resolveAppContext } from "./runtime.js"
import type {
  AppContext,
  ArtifactData,
  PreviewResult,
  Printer,
  PrintResult,
  RenderOptions,
  Template,
  UserTemplateSummary,
} from "./types.js"
import { listUserTemplates } from "./user-template-store.js"

type UiPrintResult = PrintResult | BrowserPrintResult

function sortPrinters(printers: Printer[]): Printer[] {
  return [...printers].sort((left, right) => {
    const leftRssi = left.rssi ?? Number.NEGATIVE_INFINITY
    const rightRssi = right.rssi ?? Number.NEGATIVE_INFINITY
    return rightRssi - leftRssi || left.id.localeCompare(right.id)
  })
}

function isPrinterUnavailableError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.includes("Printer is no longer available")
}

function summarizeSourceTitle(source: BrowserPrintSource): string {
  switch (source.kind) {
    case "template":
      return source.templateId
    case "canvas":
      return source.canvas.name
    case "safe-text":
      return source.title
  }
}

export type WorkbenchController = ReturnType<typeof useWorkbenchController>

export function useWorkbenchController({
  client: providedClient,
  context: providedContext,
}: {
  client?: ApiClient
  context?: AppContext
} = {}) {
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
  const [printers, setPrinters] = React.useState<Printer[]>([])
  const [printerId, setPrinterId] = React.useState("")
  const [serverPrinterSelectionMode, setServerPrinterSelectionMode] = React.useState<
    "none" | "auto" | "explicit"
  >("none")
  const [preferredPrinterName, setPreferredPrinterName] = React.useState("")
  const [renderOptions, setRenderOptions] = React.useState<RenderOptions>(defaultRenderOptions)
  const [preview, setPreview] = React.useState<PreviewResult | null>(null)
  const [artifactData, setArtifactData] = React.useState<ArtifactData | null>(null)
  const [previewPrintSource, setPreviewPrintSource] = React.useState<BrowserPrintSource | null>(
    null
  )
  const [browserPrinter, setBrowserPrinter] = React.useState<BrowserPrinterSession | null>(
    context.mode === "demo" ? null : getSelectedBrowserPrinter()
  )
  const [printResult, setPrintResult] = React.useState<UiPrintResult | null>(null)
  const [probeResult, setProbeResult] = React.useState<{
    ok: boolean
    message: string
    stage: string
    log: string[]
  } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [recentActivity, setRecentActivity] = React.useState<RecentActivityState>(() =>
    loadRecentActivity()
  )
  const [userTemplates, setUserTemplates] = React.useState<UserTemplateSummary[]>([])

  const browserPrintSupported = React.useMemo(() => isBrowserPrintSupported(), [])
  const browserDirectConfigured = context.capabilities.browserDirectPrintPath !== "disabled"
  const browserDirectAvailable = browserDirectConfigured && browserPrintSupported
  const serviceApiLive = context.capabilities.serviceApiPrintPath === "available"
  const serviceApiUsable =
    context.capabilities.serviceApiPrintPath === "available" ||
    context.capabilities.serviceApiPrintPath === "mocked"
  const hasServerPrinterFlow = context.capabilities.serviceApiPrintPath === "available"

  const selectedPrinter = React.useMemo(
    () => printers.find((printer) => printer.id === printerId) ?? null,
    [printerId, printers]
  )

  const preferredPrinterNameRef = React.useRef(preferredPrinterName)

  React.useEffect(() => {
    preferredPrinterNameRef.current = preferredPrinterName
  }, [preferredPrinterName])

  const run = React.useCallback(
    async <T,>(key: string, task: () => Promise<T>): Promise<T | undefined> => {
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
    },
    []
  )

  const syncArtifactData = React.useCallback(
    async (nextPreview: PreviewResult) => {
      const data = await client.readArtifactData(nextPreview.artifact)
      setPreview(nextPreview)
      setArtifactData(data)
      setPrintResult(null)
      setProbeResult(null)
    },
    [client]
  )

  const syncBrowserArtifact = React.useCallback(async (source: BrowserPrintSource) => {
    const materialized = await materializeBrowserArtifactData(source)
    setPreview({ artifact: materialized.artifact })
    setArtifactData(materialized.data)
    setPreviewPrintSource(source)
    setPrintResult(null)
    setProbeResult(null)
    return materialized
  }, [])

  const refreshSetup = React.useCallback(
    async (preferredName = preferredPrinterNameRef.current) => {
      const nextTemplates = await client.listTemplates()
      const setup = serviceApiUsable
        ? await loadSetup(client, [], preferredName)
        : {
            printers: [] as Printer[],
            selectedPrinter: null,
            selectedPrinterReason: "none" as const,
          }

      if (nextTemplates.length > 0) {
        setTemplates(nextTemplates)
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
        preferredPrinterNameRef.current = nextSelectedPrinter.name
        setPreferredPrinterName(nextSelectedPrinter.name)
      } else if (nextPrinters.length === 0) {
        preferredPrinterNameRef.current = ""
        setPreferredPrinterName("")
      }
      return {
        templates: nextTemplates,
        printers: nextPrinters,
        selectedPrinter: nextSelectedPrinter,
      }
    },
    [client, serviceApiUsable]
  )

  const refreshUserTemplates = React.useCallback(async () => {
    const nextTemplates = await listUserTemplates()
    setUserTemplates(nextTemplates)
    return nextTemplates
  }, [])

  React.useEffect(() => {
    void (async () => {
      try {
        await refreshSetup()
        await refreshUserTemplates()
      } catch {
        setTemplates(fallbackTemplates)
      }
    })()
  }, [refreshSetup, refreshUserTemplates])

  React.useEffect(() => {
    if (context.mode === "demo" || !browserDirectAvailable || browserPrinter !== null) {
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
        // Ignore silent restore failures.
      })

    return () => {
      cancelled = true
    }
  }, [browserDirectAvailable, browserPrinter, context.mode])

  React.useEffect(() => {
    if (!browserPrinter || serverPrinterSelectionMode !== "auto") {
      return
    }

    setPrinterId("")
    setServerPrinterSelectionMode("none")
    setPreferredPrinterName("")
  }, [browserPrinter, serverPrinterSelectionMode])

  const rememberPrinterSelection = React.useCallback(
    (nextPrinterId: string) => {
      setPrinterId(nextPrinterId)
      setServerPrinterSelectionMode(nextPrinterId ? "explicit" : "none")
      const nextPrinter = printers.find((printer) => printer.id === nextPrinterId)
      if (nextPrinter?.name) {
        preferredPrinterNameRef.current = nextPrinter.name
        setPreferredPrinterName(nextPrinter.name)
        return
      }

      if (!nextPrinterId) {
        preferredPrinterNameRef.current = ""
        setPreferredPrinterName("")
      }
    },
    [printers]
  )

  const runServerTaskWithRecovery = React.useCallback(
    async <T,>(key: string, task: (printer: Printer) => Promise<T>): Promise<T | undefined> => {
      if (!selectedPrinter) {
        setError("先选择一个 service-api 打印机。")
        return
      }

      return run(key, async () => {
        try {
          return await task(selectedPrinter)
        } catch (cause) {
          if (!selectedPrinter.name || !isPrinterUnavailableError(cause)) {
            throw cause
          }

          const setup = await refreshSetup(selectedPrinter.name)
          const reboundPrinter =
            setup.selectedPrinter ??
            setup.printers.find((printer) => printer.name === selectedPrinter.name)
          if (!reboundPrinter) {
            throw cause
          }

          return task(reboundPrinter)
        }
      })
    },
    [refreshSetup, run, selectedPrinter]
  )

  const executeServerPreview = React.useCallback(
    async (source: BrowserPrintSource): Promise<PreviewResult> => {
      switch (source.kind) {
        case "template":
          return client.previewTemplate({
            templateId: source.templateId,
            input: source.input,
            renderOptions: source.renderOptions,
          })
        case "canvas":
          return client.previewCanvas({
            canvas: source.canvas,
            renderOptions: source.renderOptions,
          })
        case "safe-text":
          return client.previewSafeText({
            text: source.text,
            title: source.title,
            renderOptions: source.renderOptions,
          })
      }
    },
    [client]
  )

  const executeServerPrint = React.useCallback(
    async (printer: Printer, source: BrowserPrintSource): Promise<PrintResult> => {
      switch (source.kind) {
        case "template":
          return client.printTemplate({
            printerId: printer.id,
            printerName: printer.name,
            templateId: source.templateId,
            input: source.input,
            renderOptions: source.renderOptions,
          })
        case "canvas":
          return client.printCanvas({
            printerId: printer.id,
            printerName: printer.name,
            canvas: source.canvas,
            renderOptions: source.renderOptions,
          })
        case "safe-text":
          return client.printSafeText({
            printerId: printer.id,
            printerName: printer.name,
            text: source.text,
            title: source.title,
            renderOptions: source.renderOptions,
          })
      }
    },
    [client]
  )

  const previewSource = React.useCallback(
    async (source: BrowserPrintSource) => {
      if (source.kind === "template") {
        const template =
          templates.find((item) => item.id === source.templateId) ??
          userTemplates.find((item) => item.id === source.templateId)
        if (template) {
          setRecentActivity(
            recordRecentTemplate({
              id: template.id,
              name: template.name,
              description: template.description,
            })
          )
        }
      }

      const result = await run(
        source.kind === "canvas" ? "preview-canvas" : `preview-${source.kind}`,
        async () => {
          if (context.mode === "demo") {
            const nextPreview = await executeServerPreview(source)
            await syncArtifactData(nextPreview)
            setPreviewPrintSource(source)
            return nextPreview
          }

          if (hasServerPrinterFlow && selectedPrinter) {
            const nextPreview = await executeServerPreview(source)
            await syncArtifactData(nextPreview)
            setPreviewPrintSource(source)
            return nextPreview
          }

          if (browserDirectConfigured || context.surface === "browser-static") {
            await syncBrowserArtifact(source)
            return null
          }

          const nextPreview = await executeServerPreview(source)
          await syncArtifactData(nextPreview)
          setPreviewPrintSource(source)
          return nextPreview
        }
      )

      return result
    },
    [
      browserDirectConfigured,
      context.mode,
      context.surface,
      executeServerPreview,
      hasServerPrinterFlow,
      run,
      selectedPrinter,
      syncArtifactData,
      syncBrowserArtifact,
      templates,
      userTemplates,
    ]
  )

  const finalizePrintSuccess = React.useCallback(
    (source: BrowserPrintSource | null, printerName: string) => {
      if (!source) {
        return
      }
      setRecentActivity(
        recordRecentPrint({
          id: `${source.kind}:${summarizeSourceTitle(source)}`,
          title: summarizeSourceTitle(source),
          kind: source.kind === "safe-text" ? "safe_text" : source.kind,
          printerName,
        })
      )
    },
    []
  )

  const printCurrentPreview = React.useCallback(async () => {
    if (!preview) {
      setError("先生成一个预览，再提交打印。")
      return
    }

    const hasTarget =
      (hasServerPrinterFlow && serviceApiUsable && printerId.length > 0) ||
      (browserDirectAvailable && browserPrinter !== null)

    if (context.mode !== "demo" && !hasTarget) {
      setError("先选择 service-api 打印机，或连接浏览器直连打印机，再提交打印。")
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
        finalizePrintSuccess(
          previewPrintSource,
          selectedPrinter?.name ?? browserPrinter?.name ?? "Demo printer"
        )
      }
      return
    }

    if (hasServerPrinterFlow && selectedPrinter) {
      if (artifactData?.preview.kind === "data-url" && previewPrintSource) {
        const result = await runServerTaskWithRecovery("server-print-source", (printer) =>
          executeServerPrint(printer, previewPrintSource)
        )
        if (result?.preview) {
          await syncArtifactData(result.preview)
        }
        if (result) {
          setPrintResult(result)
          finalizePrintSuccess(previewPrintSource, selectedPrinter.name ?? selectedPrinter.id)
        }
        return
      }

      const result = await runServerTaskWithRecovery("server-print-artifact", (printer) =>
        client.printArtifact({
          printerId: printer.id,
          printerName: printer.name,
          artifactId: preview.artifact.id,
        })
      )
      if (result) {
        setPrintResult(result)
        finalizePrintSuccess(previewPrintSource, selectedPrinter.name ?? selectedPrinter.id)
      }
      return
    }

    if (browserPrinter && previewPrintSource) {
      const result = await run("browser-print", async () => {
        const materialized = await materializeBrowserArtifactData(previewPrintSource)
        const print = await printPreviewArtifact(browserPrinter, {
          id: materialized.artifact.id,
          packets: materialized.data.packets,
        })
        return { materialized, print }
      })
      if (result) {
        setPreview({ artifact: result.materialized.artifact })
        setArtifactData(result.materialized.data)
        setPrintResult(result.print)
        finalizePrintSuccess(previewPrintSource, browserPrinter.name)
      }
      return
    }

    if (!artifactData || !browserPrinter) {
      setError("先连接当前浏览器中的打印机。")
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
      finalizePrintSuccess(previewPrintSource, browserPrinter.name)
    }
  }, [
    artifactData,
    browserDirectAvailable,
    browserPrinter,
    client,
    context.mode,
    executeServerPrint,
    finalizePrintSuccess,
    hasServerPrinterFlow,
    preview,
    previewPrintSource,
    printerId,
    run,
    runServerTaskWithRecovery,
    selectedPrinter,
    serviceApiUsable,
    syncArtifactData,
  ])

  const printSourceDirect = React.useCallback(
    async (source: BrowserPrintSource) => {
      if (source.kind === "template") {
        const template =
          templates.find((item) => item.id === source.templateId) ??
          userTemplates.find((item) => item.id === source.templateId)
        if (template) {
          setRecentActivity(
            recordRecentTemplate({
              id: template.id,
              name: template.name,
              description: template.description,
            })
          )
        }
      }

      const hasTarget =
        (hasServerPrinterFlow && serviceApiUsable && printerId.length > 0) ||
        (browserDirectAvailable && browserPrinter !== null)

      if (context.mode !== "demo" && !hasTarget) {
        setError("先选择 service-api 打印机，或连接浏览器直连打印机，再提交打印。")
        return
      }

      if (context.mode === "demo") {
        const result = await run(`demo-print-${source.kind}`, () =>
          executeServerPrint(
            {
              id: selectedPrinter?.id ?? browserPrinter?.deviceId ?? "demo-printer",
              name: selectedPrinter?.name ?? browserPrinter?.name ?? "Demo printer",
              capabilities: {
                printWidthDots: source.renderOptions.printWidthDots,
                supportedPaperTypes: ["continuous", "gap"],
              },
            },
            source
          )
        )
        if (result?.preview) {
          await syncArtifactData(result.preview)
        }
        if (result) {
          setPreviewPrintSource(source)
          setPrintResult(result)
          finalizePrintSuccess(
            source,
            selectedPrinter?.name ?? browserPrinter?.name ?? "Demo printer"
          )
        }
        return
      }

      if (hasServerPrinterFlow && selectedPrinter) {
        const result = await runServerTaskWithRecovery(`server-print-${source.kind}`, (printer) =>
          executeServerPrint(printer, source)
        )
        if (result?.preview) {
          await syncArtifactData(result.preview)
        }
        if (result) {
          setPreviewPrintSource(source)
          setPrintResult(result)
          finalizePrintSuccess(source, selectedPrinter.name ?? selectedPrinter.id)
        }
        return
      }

      const result = await run(`browser-print-${source.kind}`, async () => {
        const materialized = await materializeBrowserArtifactData(source)
        if (!browserPrinter) {
          throw new Error("先连接当前浏览器中的打印机。")
        }
        const print = await printPreviewArtifact(browserPrinter, {
          id: materialized.artifact.id,
          packets: materialized.data.packets,
        })
        return { materialized, print }
      })

      if (result) {
        setPreview({ artifact: result.materialized.artifact })
        setArtifactData(result.materialized.data)
        setPreviewPrintSource(source)
        setPrintResult(result.print)
        finalizePrintSuccess(source, browserPrinter?.name ?? "Browser printer")
      }
    },
    [
      browserDirectAvailable,
      browserPrinter,
      context.mode,
      executeServerPrint,
      finalizePrintSuccess,
      hasServerPrinterFlow,
      printerId,
      run,
      runServerTaskWithRecovery,
      selectedPrinter,
      serviceApiUsable,
      syncArtifactData,
      templates,
      userTemplates,
    ]
  )

  const connectPhysicalPrinter = React.useCallback(async () => {
    if (!browserDirectConfigured) {
      setError("浏览器直连打印链路已被产品开关关闭。")
      return
    }
    if (context.mode === "demo") {
      setError("Demo mode 不触发真实硬件连接。")
      return
    }
    if (!browserPrintSupported) {
      setError("当前浏览器不支持 Web Bluetooth。")
      return
    }
    const result = await run("connect-browser-printer", () => connectBrowserPrinter())
    if (result) {
      setBrowserPrinter(result)
    }
  }, [browserDirectConfigured, browserPrintSupported, context.mode, run])

  const probeSelectedPrinter = React.useCallback(async () => {
    if (!selectedPrinter) {
      setError("先选择一个 service-api 打印机。")
      return
    }
    const result = await run("probe-printer", () =>
      client.probePrinter({
        printerId: selectedPrinter.id,
        printerName: selectedPrinter.name,
      })
    )
    if (result) {
      setProbeResult(result)
    }
  }, [client, run, selectedPrinter])

  return {
    artifactData,
    browserDirectAvailable,
    browserDirectConfigured,
    browserPrintSupported,
    browserPrinter,
    busy,
    client,
    connectPhysicalPrinter,
    context,
    error,
    hasServerPrinterFlow,
    preview,
    previewPrintSource,
    previewSource,
    preferredPrinterName,
    printCurrentPreview,
    printers,
    printResult,
    printSourceDirect,
    probeResult,
    probeSelectedPrinter,
    recentActivity,
    refreshSetup,
    rememberPrinterSelection,
    renderOptions,
    selectedPrinter,
    serverPrinterSelectionMode,
    serviceApiLive,
    serviceApiUsable,
    setError,
    setPreview,
    setPreviewPrintSource,
    setProbeResult,
    setRenderOptions,
    setRecentActivity,
    templates,
    refreshUserTemplates,
    userTemplates,
  }
}

export function createInitialTemplateRows(template: Template | undefined, count = 3) {
  if (!template) {
    return []
  }
  return Array.from({ length: count }, (_, index) => ({
    id: `${template.id}-${index + 1}`,
    values: buildInputFromTemplate(template),
  }))
}
