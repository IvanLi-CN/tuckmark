import React from "react"

import { type ApiClient, createApiClient, loadSetup } from "./api-client.js"
import {
  type BrowserPrintResult,
  type BrowserPrinterSession,
  connectBrowserPrinter,
  getSelectedBrowserPrinter,
  isBrowserPrintSupported,
  printPreviewArtifact,
} from "./browser-printer.js"
import {
  buildInputFromTemplate,
  defaultRenderOptions,
  fallbackInputs,
  fallbackTemplates,
} from "./demo-data.js"
import { resolveAppContext } from "./runtime.js"
import type {
  AppContext,
  PreviewArtifact,
  PreviewResult,
  PrintResult,
  Printer,
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
    <div className="app-shell" data-mode={context.mode}>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Tuckmark</p>
          <h1>单标签打印主链路</h1>
          <p className="lede">
            模板填充、单条安全文本、预览产物与打印提交全部共用同一份 artifact。
          </p>
        </div>
        <div className="hero-card">
          <strong>{buildModeLabel(context.mode)}</strong>
          <span>Server Render → Server Print / Browser BLE Print</span>
          <span>预览与实体打印共用同一份 artifact</span>
          <div className="mode-badges">
            <span className="pill">base {context.basePath || "/"}</span>
            <span className="pill">
              {context.capabilities.serverPrint === "available"
                ? "server print live"
                : "server print mocked"}
            </span>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="panel config-panel">
          <h2>打印配置</h2>
          <label>
            后端探测打印机
            <select
              value={printerId}
              onChange={(event) => rememberPrinterSelection(event.target.value)}
            >
              {printers.length !== 1 ? <option value="">请选择打印机</option> : null}
              {printers.length > 0 ? (
                printers.map((printer) => (
                  <option key={printer.id} value={printer.id}>
                    {printer.name ?? printer.id}
                  </option>
                ))
              ) : (
                <option value="">当前模式没有后端打印机</option>
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void run("refresh-setup", refreshSetup)}
            disabled={busy !== null}
          >
            刷新模板与打印机
          </button>
          <button
            type="button"
            onClick={connectPhysicalPrinter}
            disabled={busy !== null || !browserPrintSupported}
          >
            连接浏览器打印机
          </button>
          <label>
            纸型
            <select
              value={renderOptions.paperType}
              onChange={(event) =>
                setRenderOptions((current) => ({
                  ...current,
                  paperType: event.target.value as RenderOptions["paperType"],
                }))
              }
            >
              <option value="continuous">连续纸</option>
              <option value="gap">间隔纸</option>
            </select>
          </label>
          <label>
            Threshold
            <input
              type="number"
              value={renderOptions.threshold}
              onChange={(event) =>
                setRenderOptions((current) => ({
                  ...current,
                  threshold: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label>
            X Offset
            <input
              type="number"
              value={renderOptions.xOffsetDots}
              onChange={(event) =>
                setRenderOptions((current) => ({
                  ...current,
                  xOffsetDots: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <div className="status-card">
            <div>浏览器实体打印机</div>
            <strong>{browserPrinter?.name ?? "未连接"}</strong>
            <span>
              {browserPrintSupported
                ? browserPrinter
                  ? `设备 ID ${browserPrinter.deviceId}`
                  : "可选：用当前浏览器选择并连接真实蓝牙打印机。"
                : "当前浏览器不支持 Web Bluetooth。"}
            </span>
          </div>
          <div className="status-card">
            <div>后端探测能力</div>
            <strong>
              {selectedPrinter?.name ??
                (context.capabilities.serverPrint === "mocked" ? "mock contract" : "未选择")}
            </strong>
            <span>
              {selectedPrinter
                ? `宽度 ${selectedPrinter.capabilities.printWidthDots} dots · 支持 ${selectedPrinter.capabilities.supportedPaperTypes.join(
                    " / "
                  )}`
                : context.capabilities.serverPrint === "mocked"
                  ? "Pages 与 mock shell 通过 capability gating 复用正式路由，不依赖真实 /api。"
                  : "需要先刷新并选中当前可见的后端打印机；浏览器直连能力可并存使用。"}
            </span>
          </div>
          <button
            type="button"
            onClick={printCurrentPreview}
            disabled={
              busy !== null ||
              !preview?.artifact?.id ||
              !hasPrintTarget(selectedServerPrinterId, browserPrinter)
            }
          >
            打印当前预览
          </button>
        </aside>

        <main className="workbench">
          <section className="panel form-panel">
            <div className="section-head">
              <div>
                <p className="section-label">Template</p>
                <h2>模板标签</h2>
              </div>
              <div className="section-actions">
                <button type="button" onClick={previewTemplate} disabled={busy !== null}>
                  生成预览
                </button>
                <button
                  type="button"
                  onClick={printTemplateDirectly}
                  disabled={
                    busy !== null || !hasPrintTarget(selectedServerPrinterId, browserPrinter)
                  }
                >
                  预览后打印
                </button>
              </div>
            </div>

            <label>
              模板
              <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>

            {activeTemplate ? <p className="meta">{activeTemplate.description}</p> : null}

            <div className="field-grid">
              {Object.entries(input).map(([key, value]) => {
                const field = activeTemplate?.fields.find((item) => item.key === key)
                return (
                  <label key={key}>
                    {field?.label ?? key}
                    <textarea
                      rows={field?.multiline ? 3 : 1}
                      value={value}
                      onChange={(event) =>
                        setInput((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                )
              })}
            </div>
          </section>

          <section className="panel form-panel">
            <div className="section-head">
              <div>
                <p className="section-label">Safe Text</p>
                <h2>单条安全文本</h2>
              </div>
              <div className="section-actions">
                <button type="button" onClick={previewSafeText} disabled={busy !== null}>
                  生成预览
                </button>
                <button
                  type="button"
                  onClick={printSafeTextDirectly}
                  disabled={
                    busy !== null || !hasPrintTarget(selectedServerPrinterId, browserPrinter)
                  }
                >
                  预览后打印
                </button>
              </div>
            </div>

            <label>
              文本内容
              <textarea
                rows={4}
                value={safeText}
                onChange={(event) => setSafeText(event.target.value)}
              />
            </label>
            <p className="meta">
              安全文本标签强制使用连续纸，用来验证“服务端渲染 + 浏览器蓝牙打印”链路。
            </p>
          </section>
        </main>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="preview-grid">
        <div className="panel preview-panel">
          <div className="section-head">
            <div>
              <p className="section-label">Artifact</p>
              <h2>当前预览</h2>
            </div>
            <span className="pill">{activeArtifact ? activeArtifact.id.slice(0, 8) : "empty"}</span>
          </div>

          {activeArtifact ? (
            <>
              <img src={client.previewImageUrl(activeArtifact)} alt="preview artifact" />
              <dl className="artifact-meta">
                <div>
                  <dt>Template</dt>
                  <dd>{activeArtifact.templateId ?? "ad-hoc"}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>
                    {activeArtifact.width} × {activeArtifact.height}
                  </dd>
                </div>
                <div>
                  <dt>Paper</dt>
                  <dd>{activeArtifact.renderOptions.paperType}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(activeArtifact.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="empty-state">先生成一个模板预览或安全文本预览，再检查产物并提交打印。</p>
          )}
        </div>

        <div className="panel result-panel">
          <div className="section-head">
            <div>
              <p className="section-label">Print Job</p>
              <h2>打印状态</h2>
            </div>
            <span className={`pill ${busy ? "pill-busy" : "pill-idle"}`}>{busy ?? "idle"}</span>
          </div>

          <p className="result-summary">{summarizePrintResult(printResult)}</p>
          <div className="status-stack">
            <div className="status-card">
              <div>Mode</div>
              <strong>{buildModeLabel(context.mode)}</strong>
              <span>
                {context.mode === "runtime"
                  ? "真实 /api contract"
                  : "Mock API layer over the formal app surface"}
              </span>
            </div>
            <div className="status-card">
              <div>Capability gate</div>
              <strong>
                {context.capabilities.serverPrint === "available"
                  ? "server print live"
                  : "server print mocked"}
              </strong>
              <span>
                {browserPrintSupported
                  ? canUseBrowserPrintPath
                    ? "Web Bluetooth path can stay real in supported browsers."
                    : "Web Bluetooth connect stays real, but print submission is gated without packet generation."
                  : "Browser BLE unavailable in this browser."}
              </span>
            </div>
          </div>
          {printResult ? <pre>{JSON.stringify(printResult, null, 2)}</pre> : null}
        </div>
      </section>
    </div>
  )
}
