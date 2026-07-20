import {
  createDraftFromPreset,
  createDraftFromSystemTemplate,
  getPresetById,
  getSystemTemplateById,
  loadStoredDraftDocument,
} from "./canvas-editor-model.js"
import type {
  CanvasDraftDocument,
  CanvasDraftSource,
  UserTemplateHistory,
  UserTemplateVersionSnapshot,
} from "./types.js"
import { loadWorkingCopy, readUserTemplateHistory } from "./user-template-store.js"

export type LoadedCanvasRouteData = {
  draft: CanvasDraftDocument
  versionHistory: UserTemplateHistory | null
}

function cloneDraft(draft: CanvasDraftDocument): CanvasDraftDocument {
  return structuredClone(draft)
}

export function resolveCanvasSource(searchParams: URLSearchParams): CanvasDraftSource {
  const rawSource = searchParams.get("source")
  if (rawSource === "preset-template") {
    return {
      kind: "preset-template",
      presetId: searchParams.get("templateId") ?? getSystemTemplateById("shipping-compact").id,
    }
  }
  if (rawSource === "user-template") {
    const templateId = searchParams.get("templateId")
    if (templateId) {
      return {
        kind: "user-template",
        templateId,
      }
    }
  }
  return {
    kind: "scratch",
    presetId: searchParams.get("presetId") ?? getPresetById("shipping-wide").id,
  }
}

export function resolveInitialCanvasPanel(searchParams: URLSearchParams): "attributes" | "output" {
  return searchParams.get("panel") === "output" ? "output" : "attributes"
}

export function resolveCanvasStatus(searchParams: URLSearchParams): string {
  const status = searchParams.get("status")
  if (status === "saved") {
    return "已保存新版本。"
  }
  if (status === "created") {
    return "已保存为用户模板。"
  }
  return ""
}

export function createRestoredDraftFromVersion(
  version: UserTemplateVersionSnapshot,
  templateId: string
): CanvasDraftDocument {
  return {
    ...cloneDraft(version.document),
    source: {
      kind: "user-template",
      templateId,
    },
    templateId,
    baseVersionId: version.id,
    lastSavedAt: undefined,
  }
}

export async function loadCanvasRouteData(
  source: CanvasDraftSource
): Promise<LoadedCanvasRouteData> {
  if (source.kind === "user-template") {
    const versionHistory = await readUserTemplateHistory(source.templateId)
    if (!versionHistory) {
      throw new Error("当前用户模板不存在，可能已经被浏览器本地数据清理。")
    }
    const workingCopy = await loadWorkingCopy(source)
    if (workingCopy?.draft) {
      return {
        draft: workingCopy.draft,
        versionHistory,
      }
    }
    const currentVersion =
      versionHistory.saved.find(
        (version) => version.id === versionHistory.template.currentVersionId
      ) ?? versionHistory.saved[0]
    if (!currentVersion) {
      throw new Error("当前用户模板缺少已保存版本。")
    }
    return {
      draft: {
        ...cloneDraft(currentVersion.document),
        name: versionHistory.template.name,
        source,
        templateId: source.templateId,
        baseVersionId: currentVersion.id,
      },
      versionHistory,
    }
  }

  if (source.kind === "preset-template") {
    const legacyDraft = loadStoredDraftDocument(source.presetId)
    if (legacyDraft) {
      return {
        draft: {
          ...legacyDraft,
          source,
        },
        versionHistory: null,
      }
    }
    const workingCopy = await loadWorkingCopy(source)
    if (workingCopy?.draft) {
      return {
        draft: {
          ...workingCopy.draft,
          source,
        },
        versionHistory: null,
      }
    }
    return {
      draft: createDraftFromSystemTemplate(getSystemTemplateById(source.presetId)),
      versionHistory: null,
    }
  }

  const legacyDraft = loadStoredDraftDocument(source.presetId)
  if (legacyDraft) {
    return {
      draft: {
        ...legacyDraft,
        source,
      },
      versionHistory: null,
    }
  }

  const workingCopy = await loadWorkingCopy(source)
  if (workingCopy?.draft) {
    return {
      draft: {
        ...workingCopy.draft,
        source,
      },
      versionHistory: null,
    }
  }

  return {
    draft: createDraftFromPreset(getPresetById(source.presetId)),
    versionHistory: null,
  }
}
