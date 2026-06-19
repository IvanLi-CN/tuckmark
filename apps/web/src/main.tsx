import React from "react";
import ReactDOM from "react-dom/client";

import {
  connectBrowserPrinter,
  getSelectedBrowserPrinter,
  isBrowserPrintSupported,
  printPreviewArtifact,
  type BrowserPrintResult,
  type BrowserPrinterSession
} from "./browser-printer.js";
import "./styles.css";

type PaperType = "continuous" | "gap";

type RenderOptions = {
  paperType: PaperType;
  threshold: number;
  xOffsetDots: number;
};

type TemplateField = {
  key: string;
  label: string;
  required: boolean;
  multiline?: boolean;
  defaultValue?: string;
};

type Template = {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
};

type Printer = {
  id: string;
  name?: string;
  rssi?: number;
  capabilities: {
    printWidthDots: number;
    supportedPaperTypes: PaperType[];
  };
};

type PreviewArtifact = {
  id: string;
  name: string;
  templateId?: string;
  renderOptions: RenderOptions & {
    printWidthDots: number;
    previewScale: number;
  };
  width: number;
  height: number;
  createdAt: string;
};

type PreviewResult = {
  artifact: PreviewArtifact;
};

type PrintResult = {
  id?: string;
  status?: string;
  preview?: PreviewResult;
  job?: {
    id: string;
    status: string;
    artifactId: string;
    printerId: string;
  };
};

type UiPrintResult = PrintResult | BrowserPrintResult;

type SetupRefreshResult = {
  printers: Printer[];
  selectedPrinter: Printer | null;
};

const fallbackTemplates: Template[] = [
  {
    id: "shipping-compact",
    name: "Compact Shipping Label",
    description: "用于收件人与订单信息的紧凑模板。",
    fields: [
      { key: "recipient", label: "Recipient", required: true },
      { key: "address", label: "Address", required: true, multiline: true },
      { key: "orderId", label: "Order ID", required: true },
      { key: "note", label: "Note", required: false, multiline: true }
    ]
  },
  {
    id: "cable-tag",
    name: "Cable Tag",
    description: "用于线缆、设备和端口整理的标签模板。",
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "port", label: "Port", required: false },
      { key: "location", label: "Location", required: false }
    ]
  }
];

const fallbackInputs: Record<string, Record<string, string>> = {
  "shipping-compact": {
    recipient: "Koha Cat",
    address: "Moon Street 42\nShanghai",
    orderId: "TM-001",
    note: "fragile"
  },
  "cable-tag": {
    name: "LAN-01",
    port: "Gi1/0/1",
    location: "Rack A"
  }
};

const defaultRenderOptions: RenderOptions = {
  paperType: "continuous",
  threshold: 150,
  xOffsetDots: 0
};

function buildInputFromTemplate(template: Template | undefined): Record<string, string> {
  if (!template) {
    return {};
  }

  const fallback = fallbackInputs[template.id] ?? {};
  return Object.fromEntries(
    template.fields.map((field) => [field.key, fallback[field.key] ?? field.defaultValue ?? ""])
  );
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed: ${response.status}`);
  }
  return json;
}

function summarizePrintResult(result: UiPrintResult | null): string {
  if (!result) {
    return "尚未打印。";
  }

  if ("message" in result) {
    return `${result.printer.name} · ${result.message}`;
  }

  if (result.job) {
    return `打印任务 ${result.job.id} 已提交，状态 ${result.job.status}。`;
  }

  if (result.id && result.status) {
    return `打印任务 ${result.id} 状态 ${result.status}。`;
  }

  return "打印已完成。";
}

function sortPrinters(printers: Printer[]): Printer[] {
  return [...printers].sort((left, right) => {
    const leftRssi = left.rssi ?? Number.NEGATIVE_INFINITY;
    const rightRssi = right.rssi ?? Number.NEGATIVE_INFINITY;
    return rightRssi - leftRssi || left.id.localeCompare(right.id);
  });
}

function hasPrintTarget(printerId: string, browserPrinter: BrowserPrinterSession | null): boolean {
  return printerId.length > 0 || browserPrinter !== null;
}

function pickPrinterId(printers: Printer[], currentId: string, preferredName?: string): string {
  if (!currentId) {
    return printers.length === 1 ? printers[0]!.id : "";
  }

  const byId = printers.find((printer) => printer.id === currentId);
  if (byId) {
    return byId.id;
  }

  if (preferredName) {
    const byName = printers.find((printer) => printer.name === preferredName);
    if (byName) {
      return byName.id;
    }
  }

  if (printers.length === 1) {
    return printers[0]!.id;
  }

  return "";
}

function isPrinterUnavailableError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.includes("Printer is no longer available");
}

export function App() {
  const [templates, setTemplates] = React.useState<Template[]>(fallbackTemplates);
  const [templateId, setTemplateId] = React.useState(fallbackTemplates[0]?.id ?? "shipping-compact");
  const [input, setInput] = React.useState<Record<string, string>>(fallbackInputs["shipping-compact"]);
  const [safeText, setSafeText] = React.useState("Tuckmark\nPrint OK");
  const [renderOptions, setRenderOptions] = React.useState<RenderOptions>(defaultRenderOptions);
  const [printers, setPrinters] = React.useState<Printer[]>([]);
  const [printerId, setPrinterId] = React.useState("");
  const [preferredPrinterName, setPreferredPrinterName] = React.useState("");
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [browserPrinter, setBrowserPrinter] = React.useState<BrowserPrinterSession | null>(
    getSelectedBrowserPrinter()
  );
  const [printResult, setPrintResult] = React.useState<UiPrintResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const browserPrintSupported = React.useMemo(() => isBrowserPrintSupported(), []);

  const activeTemplate = React.useMemo(
    () => templates.find((template) => template.id === templateId) ?? templates[0],
    [templateId, templates]
  );

  const selectedPrinter = React.useMemo(
    () => printers.find((printer) => printer.id === printerId),
    [printerId, printers]
  );
  const selectedServerPrinterId = selectedPrinter?.id ?? "";
  const printerIdRef = React.useRef(printerId);
  const preferredPrinterNameRef = React.useRef(preferredPrinterName);

  React.useEffect(() => {
    printerIdRef.current = printerId;
  }, [printerId]);

  React.useEffect(() => {
    preferredPrinterNameRef.current = preferredPrinterName;
  }, [preferredPrinterName]);

  const loadSetup = React.useCallback(async (): Promise<SetupRefreshResult> => {
    const [templateResponse, printerResponse] = await Promise.all([
      requestJson<{ templates: Template[] }>("/api/templates"),
      requestJson<{ printers: Printer[] }>("/api/printers")
    ]);
    const nextPrinters = sortPrinters(printerResponse.printers);

    if (templateResponse.templates.length > 0) {
      setTemplates(templateResponse.templates);
      setTemplateId((current) => {
        const next = templateResponse.templates.find((template) => template.id === current);
        return next?.id ?? templateResponse.templates[0]!.id;
      });
    }

    const nextPrinterId = pickPrinterId(
      nextPrinters,
      printerIdRef.current,
      preferredPrinterNameRef.current
    );
    const nextSelectedPrinter = nextPrinters.find((printer) => printer.id === nextPrinterId) ?? null;

    setPrinters(nextPrinters);
    setPrinterId(nextPrinterId);
    if (nextSelectedPrinter?.name) {
      setPreferredPrinterName(nextSelectedPrinter.name);
    }

    return {
      printers: nextPrinters,
      selectedPrinter: nextSelectedPrinter
    };
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        await loadSetup();
      } catch {
        setTemplates(fallbackTemplates);
      }
    })();
  }, [loadSetup]);

  React.useEffect(() => {
    setInput(buildInputFromTemplate(activeTemplate));
  }, [activeTemplate]);

  async function run<T>(key: string, task: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    setError(null);
    try {
      return await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function previewTemplate() {
    const result = await run("preview-template", () =>
      requestJson<PreviewResult>("/api/preview/template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId, input, renderOptions })
      })
    );

    if (result) {
      setPreview(result);
      setPrintResult(null);
    }
  }

  async function connectPhysicalPrinter() {
    const result = await run("connect-browser-printer", () => connectBrowserPrinter());
    if (result) {
      setBrowserPrinter(result);
    }
  }

  function rememberPrinterSelection(nextPrinterId: string) {
    setPrinterId(nextPrinterId);
    const nextPrinter = printers.find((printer) => printer.id === nextPrinterId);
    if (nextPrinter?.name) {
      setPreferredPrinterName(nextPrinter.name);
      return;
    }

    if (!nextPrinterId) {
      setPreferredPrinterName("");
    }
  }

  async function postServerPrintWithRecovery<T>(
    key: string,
    printer: Printer,
    path: string,
    bodyFactory: (resolvedPrinter: Printer) => Record<string, unknown>
  ): Promise<T | undefined> {
    const submit = (resolvedPrinter: Printer) =>
      requestJson<T>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bodyFactory(resolvedPrinter))
      });

    return run(key, async () => {
      try {
        return await submit(printer);
      } catch (cause) {
        if (!printer.name || !isPrinterUnavailableError(cause)) {
          throw cause;
        }

        const refreshed = await loadSetup();
        const reboundPrinter = refreshed.printers.find((item) => item.name === printer.name);
        if (!reboundPrinter) {
          throw cause;
        }

        return submit(reboundPrinter);
      }
    });
  }

  async function sendArtifactToSelectedPrinter(artifact: PreviewArtifact) {
    if (selectedPrinter) {
      const result = await postServerPrintWithRecovery<PrintResult>(
        "server-print-artifact",
        selectedPrinter,
        "/api/print/artifact",
        (printer) => ({
          printerId: printer.id,
          printerName: printer.name,
          artifactId: artifact.id
        })
      );

      if (result) {
        setPrintResult(result);
      }
      return;
    }

    if (!browserPrinter) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。");
      return;
    }

    const result = await run("browser-print", () =>
      printPreviewArtifact(browserPrinter, {
        id: artifact.id,
        pngUrl: `/api/artifacts/${artifact.id}/png`,
        renderOptions: artifact.renderOptions
      })
    );

    if (result) {
      setPrintResult(result);
    }
  }

  async function printTemplateDirectly() {
    if (!hasPrintTarget(selectedServerPrinterId, browserPrinter)) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。");
      return;
    }

    if (selectedPrinter) {
      const result = await postServerPrintWithRecovery<PrintResult>(
        "server-preview-and-print-template",
        selectedPrinter,
        "/api/print/template",
        (printer) => ({
          printerId: printer.id,
          printerName: printer.name,
          templateId,
          input,
          renderOptions
        })
      );

      if (result) {
        if (result.preview) {
          setPreview(result.preview);
        }
        setPrintResult(result);
      }
      return;
    }

    if (browserPrinter) {
      const result = await run("preview-and-print-template", async () => {
        const nextPreview = await requestJson<PreviewResult>("/api/preview/template", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateId, input, renderOptions })
        });

        const print = await printPreviewArtifact(browserPrinter, {
          id: nextPreview.artifact.id,
          pngUrl: `/api/artifacts/${nextPreview.artifact.id}/png`,
          renderOptions: nextPreview.artifact.renderOptions
        });

        return { preview: nextPreview, print };
      });

      if (result) {
        setPreview(result.preview);
        setPrintResult(result.print);
      }
      return;
    }

    setError("未找到可用打印目标。");
  }

  async function printSafeTextDirectly() {
    if (!hasPrintTarget(selectedServerPrinterId, browserPrinter)) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。");
      return;
    }

    if (selectedPrinter) {
      const result = await postServerPrintWithRecovery<PrintResult>(
        "server-preview-and-print-safe-text",
        selectedPrinter,
        "/api/print/safe-text",
        (printer) => ({
          printerId: printer.id,
          printerName: printer.name,
          text: safeText,
          title: "Safe Text Label",
          renderOptions: {
            ...renderOptions,
            paperType: "continuous"
          }
        })
      );

      if (result) {
        if ("preview" in result && result.preview) {
          setPreview(result.preview);
        }
        setPrintResult(result);
      }
      return;
    }

    const result = await run("preview-and-print-template", async () => {
      if (browserPrinter) {
        const nextPreview = await requestJson<PreviewResult>("/api/preview/safe-text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: safeText,
            title: "Safe Text Label",
            renderOptions: {
              ...renderOptions,
              paperType: "continuous"
            }
          })
        });

        const print = await printPreviewArtifact(browserPrinter, {
          id: nextPreview.artifact.id,
          pngUrl: `/api/artifacts/${nextPreview.artifact.id}/png`,
          renderOptions: nextPreview.artifact.renderOptions
        });

        return { preview: nextPreview, print };
      }

      throw new Error("未找到可用打印目标。");
    });

    if (result) {
      setPreview(result.preview);
      setPrintResult(result.print);
    }
  }

  async function previewSafeText() {
    const result = await run("preview-safe-text", () =>
      requestJson<PreviewResult>("/api/preview/safe-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: safeText,
          title: "Safe Text Label",
          renderOptions: {
            ...renderOptions,
            paperType: "continuous"
          }
        })
      })
    );

    if (result) {
      setPreview(result);
      setPrintResult(null);
    }
  }

  async function printCurrentPreview() {
    if (!hasPrintTarget(selectedServerPrinterId, browserPrinter)) {
      setError("先选择后端探测打印机，或连接浏览器打印机，再提交打印。");
      return;
    }

    if (!preview?.artifact.id) {
      setError("先生成一个预览，再提交打印。");
      return;
    }

    await sendArtifactToSelectedPrinter(preview.artifact);
  }

  return (
    <div className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Tuckmark</p>
          <h1>单标签打印主链路</h1>
          <p className="lede">
            模板填充、单条安全文本、预览产物与打印提交全部共用同一份 artifact。
          </p>
        </div>
        <div className="hero-card">
          <strong>Web Print Path</strong>
          <span>Server Render → Server Print / Browser BLE Print</span>
          <span>预览与实体打印共用同一份 artifact</span>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="panel config-panel">
          <h2>打印配置</h2>
          <label>
            后端探测打印机
            <select value={printerId} onChange={(event) => rememberPrinterSelection(event.target.value)}>
              {printers.length !== 1 ? <option value="">请选择打印机</option> : null}
              {printers.length > 0 ? (
                printers.map((printer) => (
                  <option key={printer.id} value={printer.id}>
                    {printer.name ?? printer.id}
                  </option>
                ))
              ) : (
                <option value="">暂无打印机</option>
              )}
            </select>
          </label>
          <button onClick={() => void run("refresh-setup", loadSetup)} disabled={busy !== null}>
            刷新模板与打印机
          </button>
          <button onClick={connectPhysicalPrinter} disabled={busy !== null || !browserPrintSupported}>
            连接浏览器打印机
          </button>
          <label>
            纸型
            <select
              value={renderOptions.paperType}
              onChange={(event) =>
                setRenderOptions((current) => ({
                  ...current,
                  paperType: event.target.value as PaperType
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
                  threshold: Number(event.target.value) || 0
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
                  xOffsetDots: Number(event.target.value) || 0
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
            <strong>{selectedPrinter?.name ?? "未选择"}</strong>
            <span>
              {selectedPrinter
                ? `宽度 ${selectedPrinter.capabilities.printWidthDots} dots · 支持 ${selectedPrinter.capabilities.supportedPaperTypes.join(
                    " / "
                  )}`
                : "需要先刷新并选中当前可见的后端打印机；浏览器直连能力可并存使用。"}
            </span>
          </div>
          <button
            onClick={printCurrentPreview}
            disabled={busy !== null || !preview?.artifact.id || !hasPrintTarget(selectedServerPrinterId, browserPrinter)}
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
                <button onClick={previewTemplate} disabled={busy !== null}>
                  生成预览
                </button>
                <button
                  onClick={printTemplateDirectly}
                  disabled={busy !== null || !hasPrintTarget(selectedServerPrinterId, browserPrinter)}
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
                const field = activeTemplate?.fields.find((item) => item.key === key);
                return (
                  <label key={key}>
                    {field?.label ?? key}
                    <textarea
                      rows={field?.multiline ? 3 : 1}
                      value={value}
                      onChange={(event) =>
                        setInput((current) => ({
                          ...current,
                          [key]: event.target.value
                        }))
                      }
                    />
                  </label>
                );
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
                <button onClick={previewSafeText} disabled={busy !== null}>
                  生成预览
                </button>
                <button
                  onClick={printSafeTextDirectly}
                  disabled={busy !== null || !hasPrintTarget(selectedServerPrinterId, browserPrinter)}
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
            <p className="meta">安全文本标签强制使用连续纸，用来验证“服务端渲染 + 浏览器蓝牙打印”链路。</p>
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
            <span className="pill">{preview ? preview.artifact.id.slice(0, 8) : "empty"}</span>
          </div>

          {preview ? (
            <>
              <img src={`/api/artifacts/${preview.artifact.id}/png`} alt="preview artifact" />
              <dl className="artifact-meta">
                <div>
                  <dt>Template</dt>
                  <dd>{preview.artifact.templateId ?? "ad-hoc"}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>
                    {preview.artifact.width} × {preview.artifact.height}
                  </dd>
                </div>
                <div>
                  <dt>Paper</dt>
                  <dd>{preview.artifact.renderOptions.paperType}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(preview.artifact.createdAt).toLocaleString()}</dd>
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
          {printResult ? <pre>{JSON.stringify(printResult, null, 2)}</pre> : null}
        </div>
      </section>
    </div>
  );
}

export function mountApp(element: HTMLElement, useStrictMode = true) {
  const root = ReactDOM.createRoot(element);
  root.render(useStrictMode ? <React.StrictMode><App /></React.StrictMode> : <App />);
  return root;
}

const rootElement = document.getElementById("root");
if (rootElement) {
  mountApp(rootElement, true);
}
