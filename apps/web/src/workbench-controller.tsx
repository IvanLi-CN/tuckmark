import React from "react"

import { type ApiClient, createApiClient, loadSetup } from "./api-client.js"
import { type BrowserPrintSource, materializeBrowserArtifactData } from "./browser-print-payload.js"
import {
  type BrowserPrintError,
  type BrowserPrinterSession,
  type BrowserPrintResult,
  connectBrowserPrinter,
  getSelectedBrowserPrinter,
  isBrowserPrintSupported,
  printPreviewArtifact,
  restoreBrowserPrinter,
} from "./browser-printer.js"
import { getSharedCrossTabCoordinator } from "./cross-tab-coordinator.js"
import type { DataArchiveInspection } from "./data-directory-service.js"
import {
  attachDataDirectory,
  createManualBackup,
  exportRuntimeArchive,
  getDataDirectoryStatus,
  importRuntimeArchive,
  inspectConfiguredBackup,
  inspectImportArchiveFile,
  pickDataDirectory,
  requestConfiguredDirectoryPermission,
  restoreConfiguredBackup,
  supportsDataDirectoryFeatures,
  syncConfiguredDataDirectory,
  tryBackgroundMirrorSync,
} from "./data-directory-service.js"
import type {
  DataDirectoryAttachmentInspection,
  DataDirectoryBackupEntry,
  DataDirectoryStatus,
} from "./data-directory-types.js"
import { buildInputFromTemplate, defaultRenderOptions, fallbackTemplates } from "./demo-data.js"
import {
  type CanvasDimension,
  getCanvasDotsCapabilityMessage,
  loadRecentCanvasDimensions,
  recordRecentCanvasDimension,
} from "./lib/canvas-dimensions.js"
import { canvasDotsToMillimeters, canvasMillimetersToDots } from "./lib/canvas-units.js"
import { loadRecentActivity, type RecentActivityState } from "./lib/recent-activity.js"
import { resolveAppContext } from "./runtime.js"
import {
  getRuntimeStoreEventTabId,
  type RuntimeStoreMutationReason,
  subscribeRuntimeStoreMutations,
} from "./runtime-store-events.js"
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
import {
  listUserTemplates,
  loadRuntimeAppSettings,
  saveRuntimeAppSettings,
} from "./user-template-store.js"
import {
  applySyncStateToBrowser,
  deleteCanvasDraftLocally,
  recordCanvasDraftLocally,
  recordRecentPrintLocally,
  recordTemplateUsageLocally,
  syncWebState,
} from "./web-state-sync.js"

type UiPrintResult = PrintResult | BrowserPrintResult
const SYNC_PRESET_IDS = ["shipping-wide", "ops-tag", "compact-note"] as const
const DATA_DIRECTORY_DEBOUNCE_MS = 900
type DeviceDrawerAction = "connect-browser-printer" | "probe-printer" | "refresh-setup"
type DeviceDrawerSection = "browser-direct" | "service-api"

type DataDirectoryDialogState =
  | {
      kind: "attach-choice"
      handle: FileSystemDirectoryHandle
      inspection: DataDirectoryAttachmentInspection
    }
  | {
      kind: "import-confirm"
      inspection: DataArchiveInspection
    }
  | {
      kind: "restore-confirm"
      entry: DataDirectoryBackupEntry
      inspection: DataArchiveInspection
    }

export type WorkbenchDataDirectoryDialogState = DataDirectoryDialogState
export type WorkbenchDeviceDrawerFeedback = {
  section: DeviceDrawerSection
  action: DeviceDrawerAction
  tone: "info" | "error"
  title: string
  message: string
}
export type WorkbenchStoryStateOverrides = {
  dataDirectoryBusy?: string | null
  dataDirectoryDialog?: DataDirectoryDialogState | null
  dataDirectoryStatus?: DataDirectoryStatus
  deviceDrawerBusyAction?: DeviceDrawerAction | null
  deviceDrawerFeedback?: WorkbenchDeviceDrawerFeedback | null
  directorySetupNudgeOpen?: boolean
}

function createDefaultDataDirectoryStatus(): DataDirectoryStatus {
  return {
    supported: supportsDataDirectoryFeatures(),
    configured: false,
    directoryName: null,
    permissionState: supportsDataDirectoryFeatures() ? "unconfigured" : "unsupported",
    health: supportsDataDirectoryFeatures() ? "unconfigured" : "unsupported",
    manifest: null,
    lastSyncAt: null,
    lastError: null,
    backups: [],
    leaseRole: "unsupported",
    leaseExpiresAt: null,
    runtimeSummary: {
      exportedAt: new Date(0).toISOString(),
      snapshotUpdatedAt: null,
      templates: 0,
      versions: 0,
      workingCopies: 0,
    },
  }
}

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

function describeDeviceDrawerFailure(
  section: DeviceDrawerSection,
  action: DeviceDrawerAction,
  cause: unknown
): WorkbenchDeviceDrawerFeedback {
  const browserPrintError = cause as Partial<BrowserPrintError> | undefined
  const message = cause instanceof Error ? cause.message : String(cause)
  if (browserPrintError?.code === "cancelled") {
    return {
      section,
      action,
      tone: "info",
      title: "已取消连接",
      message: message.includes("重试") ? message : `${message} 可直接再次点击下方按钮重试。`,
    }
  }

  switch (action) {
    case "connect-browser-printer":
      return { section, action, tone: "error", title: "连接失败", message }
    case "probe-printer":
      return { section, action, tone: "error", title: "探测失败", message }
    case "refresh-setup":
      return { section, action, tone: "error", title: "刷新设备失败", message }
  }
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

function getPrintTargetWidth(source: BrowserPrintSource, printer: Printer | null): number {
  return printer?.capabilities.printWidthDots ?? source.renderOptions.printWidthDots
}

export type WorkbenchController = ReturnType<typeof useWorkbenchController>

export function useWorkbenchController({
  client: providedClient,
  context: providedContext,
  storyStateOverrides,
}: {
  client?: ApiClient
  context?: AppContext
  storyStateOverrides?: WorkbenchStoryStateOverrides
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
  const [renderOptions, setRenderOptionsState] = React.useState<RenderOptions>(defaultRenderOptions)
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
  const [canvasDimensions, setCanvasDimensions] = React.useState(() => loadRecentCanvasDimensions())
  const [userTemplates, setUserTemplates] = React.useState<UserTemplateSummary[]>([])
  const [dataDirectoryStatus, setDataDirectoryStatus] = React.useState<DataDirectoryStatus>(
    () => storyStateOverrides?.dataDirectoryStatus ?? createDefaultDataDirectoryStatus()
  )
  const [dataDirectoryBusy, setDataDirectoryBusy] = React.useState<string | null>(
    storyStateOverrides?.dataDirectoryBusy ?? null
  )
  const [deviceDrawerBusyAction, setDeviceDrawerBusyAction] =
    React.useState<DeviceDrawerAction | null>(storyStateOverrides?.deviceDrawerBusyAction ?? null)
  const [deviceDrawerFeedback, setDeviceDrawerFeedback] =
    React.useState<WorkbenchDeviceDrawerFeedback | null>(
      storyStateOverrides?.deviceDrawerFeedback ?? null
    )
  const [dataDirectoryDialog, setDataDirectoryDialog] =
    React.useState<DataDirectoryDialogState | null>(
      storyStateOverrides?.dataDirectoryDialog ?? null
    )
  const [directorySetupNudgeOpen, setDirectorySetupNudgeOpen] = React.useState(
    storyStateOverrides?.directorySetupNudgeOpen ?? false
  )
  const [startupSyncReady, setStartupSyncReady] = React.useState(
    !(context.surface === "server-http" && context.mode === "runtime")
  )
  const syncInFlightRef = React.useRef<Promise<void> | null>(null)
  const syncQueuedRef = React.useRef(false)
  const dataDirectorySyncTimerRef = React.useRef<number | null>(null)
  const coordinator = React.useMemo(() => getSharedCrossTabCoordinator(), [])
  const runtimeEventTabId = React.useMemo(() => getRuntimeStoreEventTabId(), [])

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

  const refreshDataDirectoryStatus = React.useCallback(async () => {
    if (storyStateOverrides?.dataDirectoryStatus) {
      setDataDirectoryStatus(storyStateOverrides.dataDirectoryStatus)
      return storyStateOverrides.dataDirectoryStatus
    }
    const next = await getDataDirectoryStatus(coordinator.getState())
    setDataDirectoryStatus(next)
    return next
  }, [coordinator, storyStateOverrides?.dataDirectoryStatus])

  React.useEffect(() => {
    if (!storyStateOverrides) {
      return
    }
    if (storyStateOverrides.dataDirectoryStatus) {
      setDataDirectoryStatus(storyStateOverrides.dataDirectoryStatus)
    }
    if ("dataDirectoryBusy" in storyStateOverrides) {
      setDataDirectoryBusy(storyStateOverrides.dataDirectoryBusy ?? null)
    }
    if ("deviceDrawerBusyAction" in storyStateOverrides) {
      setDeviceDrawerBusyAction(storyStateOverrides.deviceDrawerBusyAction ?? null)
    }
    if ("deviceDrawerFeedback" in storyStateOverrides) {
      setDeviceDrawerFeedback(storyStateOverrides.deviceDrawerFeedback ?? null)
    }
    if ("dataDirectoryDialog" in storyStateOverrides) {
      setDataDirectoryDialog(storyStateOverrides.dataDirectoryDialog ?? null)
    }
    if ("directorySetupNudgeOpen" in storyStateOverrides) {
      setDirectorySetupNudgeOpen(Boolean(storyStateOverrides.directorySetupNudgeOpen))
    }
  }, [storyStateOverrides])

  const setRenderOptions = React.useCallback((next: React.SetStateAction<RenderOptions>) => {
    setRenderOptionsState(next)
  }, [])

  const updateRenderOptions = React.useCallback((next: React.SetStateAction<RenderOptions>) => {
    setRenderOptionsState((current) => {
      const resolved = typeof next === "function" ? next(current) : next
      void saveRuntimeAppSettings({
        defaultRenderOptions: resolved,
      })
      return resolved
    })
  }, [])

  const resolveSourceDimension = React.useCallback(
    (source: BrowserPrintSource | null): CanvasDimension | null => {
      if (!source) {
        return null
      }
      if (source.kind === "canvas") {
        return {
          width: canvasDotsToMillimeters(source.canvas.width),
          height: canvasDotsToMillimeters(source.canvas.height),
        }
      }
      if (source.kind === "template") {
        const userTemplate = userTemplates.find((item) => item.id === source.templateId)
        if (userTemplate) {
          return { width: userTemplate.width, height: userTemplate.height }
        }
        const template = templates.find((item) => item.id === source.templateId)
        return template?.width && template.height
          ? {
              width: canvasDotsToMillimeters(template.width),
              height: canvasDotsToMillimeters(template.height),
            }
          : null
      }
      return null
    },
    [templates, userTemplates]
  )

  const resolveSourceWidthDots = React.useCallback(
    (source: BrowserPrintSource | null): number | null => {
      if (!source) {
        return null
      }
      if (source.kind === "canvas") {
        return source.canvas.width
      }
      if (source.kind === "template") {
        const userTemplate = userTemplates.find((item) => item.id === source.templateId)
        if (userTemplate) {
          return canvasMillimetersToDots(userTemplate.width)
        }
        const template = templates.find((item) => item.id === source.templateId)
        return template?.width ?? null
      }
      return null
    },
    [templates, userTemplates]
  )

  const recordCanvasDimension = React.useCallback((dimension: CanvasDimension) => {
    setCanvasDimensions(recordRecentCanvasDimension(dimension))
  }, [])

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

  const refreshRenderOptionsFromStore = React.useCallback(async () => {
    const settings = await loadRuntimeAppSettings()
    setRenderOptionsState(settings.defaultRenderOptions)
    return settings
  }, [])

  const runDataDirectoryTask = React.useCallback(
    async <T,>(key: string, task: () => Promise<T>): Promise<T | undefined> => {
      setDataDirectoryBusy(key)
      setError(null)
      try {
        return await task()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        await refreshDataDirectoryStatus().catch(() => undefined)
        return undefined
      } finally {
        setDataDirectoryBusy(null)
      }
    },
    [refreshDataDirectoryStatus]
  )

  const clearDeviceDrawerFeedback = React.useCallback(() => {
    setDeviceDrawerFeedback(null)
  }, [])

  const resetDeviceDrawerState = React.useCallback(() => {
    setDeviceDrawerBusyAction(null)
    setDeviceDrawerFeedback(null)
  }, [])

  const runDeviceDrawerTask = React.useCallback(
    async <T,>(
      section: DeviceDrawerSection,
      action: DeviceDrawerAction,
      task: () => Promise<T>
    ): Promise<T | undefined> => {
      setDeviceDrawerBusyAction(action)
      setDeviceDrawerFeedback(null)
      try {
        return await task()
      } catch (cause) {
        setDeviceDrawerFeedback(describeDeviceDrawerFailure(section, action, cause))
        return undefined
      } finally {
        setDeviceDrawerBusyAction(null)
      }
    },
    []
  )

  const scheduleDataDirectorySync = React.useCallback(
    (reason: RuntimeStoreMutationReason) => {
      if (dataDirectorySyncTimerRef.current !== null) {
        window.clearTimeout(dataDirectorySyncTimerRef.current)
      }
      const delay =
        reason === "autosave-saved" || reason === "working-copy-replaced"
          ? DATA_DIRECTORY_DEBOUNCE_MS
          : 0
      dataDirectorySyncTimerRef.current = window.setTimeout(() => {
        dataDirectorySyncTimerRef.current = null
        void tryBackgroundMirrorSync(coordinator).finally(() => {
          void refreshDataDirectoryStatus()
        })
      }, delay)
    },
    [coordinator, refreshDataDirectoryStatus]
  )

  const maybeOpenDirectorySetupNudge = React.useCallback(async () => {
    if (!supportsDataDirectoryFeatures()) {
      return
    }
    const [settings, status] = await Promise.all([
      loadRuntimeAppSettings(),
      refreshDataDirectoryStatus(),
    ])
    if (settings.permissionNudgeSeen || status.configured) {
      return
    }
    setDirectorySetupNudgeOpen(true)
    await saveRuntimeAppSettings({
      permissionNudgeSeen: true,
    })
  }, [refreshDataDirectoryStatus])

  React.useEffect(() => {
    coordinator.start()
    const unsubscribe = coordinator.subscribe((state) => {
      setDataDirectoryStatus((current) => ({
        ...current,
        leaseRole: state.role,
        leaseExpiresAt: state.leaseExpiresAt,
      }))
      void refreshDataDirectoryStatus()
    })
    return () => {
      unsubscribe()
      coordinator.stop()
    }
  }, [coordinator, refreshDataDirectoryStatus])

  React.useEffect(() => {
    setStartupSyncReady(!(context.surface === "server-http" && context.mode === "runtime"))
    void (async () => {
      try {
        await Promise.all([
          refreshSetup(),
          refreshUserTemplates(),
          refreshRenderOptionsFromStore(),
          refreshDataDirectoryStatus(),
        ])
        if (context.surface === "server-http" && context.mode === "runtime") {
          const next = await syncWebState(client, [...SYNC_PRESET_IDS])
          setRecentActivity(next.recentActivity)
        }
      } catch {
        setTemplates(fallbackTemplates)
      } finally {
        setStartupSyncReady(true)
      }
    })()
  }, [
    client,
    context.mode,
    context.surface,
    refreshDataDirectoryStatus,
    refreshRenderOptionsFromStore,
    refreshSetup,
    refreshUserTemplates,
  ])

  React.useEffect(() => {
    const unsubscribe = subscribeRuntimeStoreMutations((event) => {
      if (event.originTabId !== runtimeEventTabId) {
        void refreshUserTemplates()
        void refreshRenderOptionsFromStore()
      }
      scheduleDataDirectorySync(event.reason)
      void refreshDataDirectoryStatus()
    })
    return () => {
      unsubscribe()
      if (dataDirectorySyncTimerRef.current !== null) {
        window.clearTimeout(dataDirectorySyncTimerRef.current)
      }
    }
  }, [
    refreshDataDirectoryStatus,
    refreshRenderOptionsFromStore,
    refreshUserTemplates,
    runtimeEventTabId,
    scheduleDataDirectorySync,
  ])

  const scheduleSync = React.useCallback(() => {
    if (context.surface !== "server-http" || context.mode !== "runtime") {
      return
    }
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true
      return
    }
    syncInFlightRef.current = (async () => {
      try {
        let shouldContinue = true
        while (shouldContinue) {
          syncQueuedRef.current = false
          const next = await syncWebState(client, [...SYNC_PRESET_IDS])
          setRecentActivity(next.recentActivity)
          shouldContinue = next.requiresResync || syncQueuedRef.current
        }
      } catch {
        // Ignore sync failures and keep the local session live.
      } finally {
        syncInFlightRef.current = null
      }
    })()
  }, [client, context.mode, context.surface])

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
          const nextState = recordTemplateUsageLocally({
            id: template.id,
            name: template.name,
            description: template.description,
          })
          setRecentActivity(applySyncStateToBrowser(nextState, [...SYNC_PRESET_IDS]))
          scheduleSync()
        }
      } else if (source.kind === "canvas" && source.templateUsage) {
        const nextState = recordTemplateUsageLocally(source.templateUsage)
        setRecentActivity(applySyncStateToBrowser(nextState, [...SYNC_PRESET_IDS]))
        scheduleSync()
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
      scheduleSync,
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
      const dimension = resolveSourceDimension(source)
      if (dimension) {
        recordCanvasDimension(dimension)
      }
      const nextState = recordRecentPrintLocally({
        id: `${source.kind}:${summarizeSourceTitle(source)}`,
        title: summarizeSourceTitle(source),
        kind: source.kind === "safe-text" ? "safe_text" : source.kind,
        printerName,
      })
      setRecentActivity(applySyncStateToBrowser(nextState, [...SYNC_PRESET_IDS]))
      scheduleSync()
    },
    [recordCanvasDimension, resolveSourceDimension, scheduleSync]
  )

  const recordCanvasDraft = React.useCallback(
    (presetId: string, draft: Parameters<typeof recordCanvasDraftLocally>[1]) => {
      const nextState = recordCanvasDraftLocally(presetId, draft)
      setRecentActivity(applySyncStateToBrowser(nextState, [...SYNC_PRESET_IDS]))
      scheduleSync()
    },
    [scheduleSync]
  )

  const deleteCanvasDraft = React.useCallback(
    (presetId: string) => {
      const nextState = deleteCanvasDraftLocally(presetId)
      setRecentActivity(applySyncStateToBrowser(nextState, [...SYNC_PRESET_IDS]))
      scheduleSync()
    },
    [scheduleSync]
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

    const sourceWidthDots = resolveSourceWidthDots(previewPrintSource)
    const capabilityError =
      previewPrintSource && sourceWidthDots
        ? getCanvasDotsCapabilityMessage(
            sourceWidthDots,
            getPrintTargetWidth(previewPrintSource, hasServerPrinterFlow ? selectedPrinter : null)
          )
        : null
    if (capabilityError) {
      setError(capabilityError)
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
    resolveSourceWidthDots,
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
          const nextState = recordTemplateUsageLocally({
            id: template.id,
            name: template.name,
            description: template.description,
          })
          setRecentActivity(applySyncStateToBrowser(nextState, [...SYNC_PRESET_IDS]))
          scheduleSync()
        }
      } else if (source.kind === "canvas" && source.templateUsage) {
        const nextState = recordTemplateUsageLocally(source.templateUsage)
        setRecentActivity(applySyncStateToBrowser(nextState, [...SYNC_PRESET_IDS]))
        scheduleSync()
      }

      const hasTarget =
        (hasServerPrinterFlow && serviceApiUsable && printerId.length > 0) ||
        (browserDirectAvailable && browserPrinter !== null)

      if (context.mode !== "demo" && !hasTarget) {
        setError("先选择 service-api 打印机，或连接浏览器直连打印机，再提交打印。")
        return
      }

      const sourceWidthDots = resolveSourceWidthDots(source)
      const capabilityError = sourceWidthDots
        ? getCanvasDotsCapabilityMessage(
            sourceWidthDots,
            getPrintTargetWidth(source, hasServerPrinterFlow ? selectedPrinter : null)
          )
        : null
      if (capabilityError) {
        setError(capabilityError)
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
      resolveSourceWidthDots,
      run,
      runServerTaskWithRecovery,
      scheduleSync,
      selectedPrinter,
      serviceApiUsable,
      syncArtifactData,
      templates,
      userTemplates,
    ]
  )

  const connectPhysicalPrinter = React.useCallback(async () => {
    if (!browserDirectConfigured) {
      setDeviceDrawerFeedback({
        section: "browser-direct",
        action: "connect-browser-printer",
        tone: "error",
        title: "连接失败",
        message: "浏览器直连打印链路已被产品开关关闭。",
      })
      return
    }
    if (context.mode === "demo") {
      setDeviceDrawerFeedback({
        section: "browser-direct",
        action: "connect-browser-printer",
        tone: "error",
        title: "连接失败",
        message: "Demo mode 不触发真实硬件连接。",
      })
      return
    }
    if (!browserPrintSupported) {
      setDeviceDrawerFeedback({
        section: "browser-direct",
        action: "connect-browser-printer",
        tone: "error",
        title: "连接失败",
        message: "当前浏览器不支持 Web Bluetooth。",
      })
      return
    }
    const result = await runDeviceDrawerTask("browser-direct", "connect-browser-printer", () =>
      connectBrowserPrinter()
    )
    if (result) {
      setBrowserPrinter(result)
    }
  }, [browserDirectConfigured, browserPrintSupported, context.mode, runDeviceDrawerTask])

  const refreshDeviceDrawerSetup = React.useCallback(async () => {
    const result = await runDeviceDrawerTask("service-api", "refresh-setup", async () => {
      const setup = await refreshSetup()
      setProbeResult(null)
      return setup
    })
    if (result) {
      setDeviceDrawerFeedback(null)
    }
  }, [refreshSetup, runDeviceDrawerTask])

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

  const probeDeviceDrawerPrinter = React.useCallback(async () => {
    if (!selectedPrinter) {
      setDeviceDrawerFeedback({
        section: "service-api",
        action: "probe-printer",
        tone: "error",
        title: "探测失败",
        message: "先选择一个 service-api 打印机。",
      })
      return
    }
    setProbeResult(null)
    const result = await runDeviceDrawerTask("service-api", "probe-printer", () =>
      client.probePrinter({
        printerId: selectedPrinter.id,
        printerName: selectedPrinter.name,
      })
    )
    if (result) {
      setProbeResult(result)
    }
  }, [client, runDeviceDrawerTask, selectedPrinter])

  const dismissDirectorySetupNudge = React.useCallback(() => {
    setDirectorySetupNudgeOpen(false)
  }, [])

  const handleImportantUserDataSaved = React.useCallback(async () => {
    await refreshDataDirectoryStatus()
    await maybeOpenDirectorySetupNudge()
  }, [maybeOpenDirectorySetupNudge, refreshDataDirectoryStatus])

  const chooseDataDirectory = React.useCallback(async () => {
    const result = await runDataDirectoryTask("pick-data-directory", async () => {
      const picked = await pickDataDirectory()
      setDataDirectoryDialog({
        kind: "attach-choice",
        handle: picked.handle,
        inspection: picked.inspection,
      })
      return picked
    })
    return result
  }, [runDataDirectoryTask])

  const cancelDataDirectoryDialog = React.useCallback(() => {
    setDataDirectoryDialog(null)
  }, [])

  const confirmDataDirectoryAttachment = React.useCallback(
    async (mode: "overwrite-current" | "import-existing") => {
      if (dataDirectoryDialog?.kind !== "attach-choice") {
        return
      }
      const result = await runDataDirectoryTask("attach-data-directory", async () => {
        const outcome = await attachDataDirectory({
          handle: dataDirectoryDialog.handle,
          mode,
        })
        await refreshDataDirectoryStatus()
        return outcome
      })
      if (!result) {
        return
      }
      setDataDirectoryDialog(null)
      setDirectorySetupNudgeOpen(false)
      if (result === "replaced-runtime" && typeof window !== "undefined") {
        window.location.reload()
      }
    },
    [dataDirectoryDialog, refreshDataDirectoryStatus, runDataDirectoryTask]
  )

  const requestDataDirectoryPermission = React.useCallback(async () => {
    await runDataDirectoryTask("request-data-directory-permission", async () => {
      await requestConfiguredDirectoryPermission(true)
      await refreshDataDirectoryStatus()
    })
  }, [refreshDataDirectoryStatus, runDataDirectoryTask])

  const syncDataDirectoryNow = React.useCallback(async () => {
    await runDataDirectoryTask("sync-data-directory", async () => {
      await syncConfiguredDataDirectory({
        coordinator,
        requestIfNeeded: true,
      })
      await refreshDataDirectoryStatus()
    })
  }, [coordinator, refreshDataDirectoryStatus, runDataDirectoryTask])

  const createManualDataBackup = React.useCallback(async () => {
    await runDataDirectoryTask("backup-data-directory", async () => {
      await createManualBackup({
        coordinator,
      })
      await refreshDataDirectoryStatus()
    })
  }, [coordinator, refreshDataDirectoryStatus, runDataDirectoryTask])

  const exportDataArchive = React.useCallback(async () => {
    await runDataDirectoryTask("export-runtime-archive", async () => {
      await exportRuntimeArchive()
    })
  }, [runDataDirectoryTask])

  const inspectImportDataArchive = React.useCallback(
    async (file: File) => {
      await runDataDirectoryTask("inspect-import-archive", async () => {
        const inspection = await inspectImportArchiveFile(file)
        setDataDirectoryDialog({
          kind: "import-confirm",
          inspection,
        })
      })
    },
    [runDataDirectoryTask]
  )

  const confirmImportDataArchive = React.useCallback(async () => {
    if (dataDirectoryDialog?.kind !== "import-confirm") {
      return
    }
    const result = await runDataDirectoryTask("import-runtime-archive", async () => {
      await importRuntimeArchive({
        coordinator,
        snapshot: dataDirectoryDialog.inspection.snapshot,
      })
      await refreshDataDirectoryStatus()
      return true
    })
    if (!result) {
      return
    }
    setDataDirectoryDialog(null)
    if (typeof window !== "undefined") {
      window.location.reload()
    }
  }, [coordinator, dataDirectoryDialog, refreshDataDirectoryStatus, runDataDirectoryTask])

  const inspectRestoreBackup = React.useCallback(
    async (entry: DataDirectoryBackupEntry) => {
      await runDataDirectoryTask("inspect-restore-backup", async () => {
        const inspection = await inspectConfiguredBackup(entry)
        setDataDirectoryDialog({
          kind: "restore-confirm",
          entry,
          inspection,
        })
      })
    },
    [runDataDirectoryTask]
  )

  const confirmRestoreBackup = React.useCallback(async () => {
    if (dataDirectoryDialog?.kind !== "restore-confirm") {
      return
    }
    const result = await runDataDirectoryTask("restore-backup", async () => {
      await restoreConfiguredBackup({
        coordinator,
        entry: dataDirectoryDialog.entry,
        snapshot: dataDirectoryDialog.inspection.snapshot,
      })
      await refreshDataDirectoryStatus()
      return true
    })
    if (!result) {
      return
    }
    setDataDirectoryDialog(null)
    if (typeof window !== "undefined") {
      window.location.reload()
    }
  }, [coordinator, dataDirectoryDialog, refreshDataDirectoryStatus, runDataDirectoryTask])

  const takeOverDataDirectoryWrites = React.useCallback(() => {
    coordinator.requestTakeover()
    void refreshDataDirectoryStatus()
  }, [coordinator, refreshDataDirectoryStatus])

  return {
    artifactData,
    browserDirectAvailable,
    browserDirectConfigured,
    browserPrintSupported,
    browserPrinter,
    busy,
    canvasDimensions,
    client,
    deleteCanvasDraft,
    connectPhysicalPrinter,
    context,
    recordCanvasDraft,
    recordCanvasDimension,
    clearDeviceDrawerFeedback,
    dataDirectoryBusy,
    dataDirectoryDialog,
    dataDirectoryStatus,
    deviceDrawerBusyAction,
    deviceDrawerFeedback,
    chooseDataDirectory,
    confirmDataDirectoryAttachment,
    cancelDataDirectoryDialog,
    requestDataDirectoryPermission,
    syncDataDirectoryNow,
    createManualDataBackup,
    exportDataArchive,
    inspectImportDataArchive,
    confirmImportDataArchive,
    inspectRestoreBackup,
    confirmRestoreBackup,
    takeOverDataDirectoryWrites,
    directorySetupNudgeOpen,
    dismissDirectorySetupNudge,
    handleImportantUserDataSaved,
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
    probeDeviceDrawerPrinter,
    probeSelectedPrinter,
    recentActivity,
    refreshDeviceDrawerSetup,
    refreshSetup,
    rememberPrinterSelection,
    renderOptions,
    refreshDataDirectoryStatus,
    resetDeviceDrawerState,
    selectedPrinter,
    serverPrinterSelectionMode,
    serviceApiLive,
    serviceApiUsable,
    setError,
    setPreview,
    setPreviewPrintSource,
    setProbeResult,
    setRenderOptions,
    updateRenderOptions,
    setRecentActivity,
    startupSyncReady,
    templates,
    refreshUserTemplates,
    userTemplates,
    scheduleSync,
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
