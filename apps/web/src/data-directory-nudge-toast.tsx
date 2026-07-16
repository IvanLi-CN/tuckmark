import { FolderOpen, X } from "lucide-react"
import { createPortal } from "react-dom"

import { Button } from "./components/ui/button.js"

export function DataDirectoryNudgeToast({
  open,
  onDismiss,
  onOpenSystem,
}: {
  open: boolean
  onDismiss: () => void
  onOpenSystem: () => void
}) {
  if (!open) {
    return null
  }

  const node = (
    <aside
      className="tm-pwa-toast tm-pwa-toast--left"
      aria-live="polite"
      aria-label="Tuckmark data directory setup"
    >
      <div className="tm-pwa-toast__icon">
        <FolderOpen className="size-4" />
      </div>
      <div className="tm-pwa-toast__body">
        <div className="tm-pwa-toast__title">建议授权数据目录</div>
        <div className="tm-pwa-toast__description">
          你已经保存了重要数据。现在可以授权一个固定目录，把数据实时落盘并启用备份恢复。
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="tm-pwa-toast__button" onClick={onOpenSystem}>
          <FolderOpen className="size-3.5" />
          <span>去系统页</span>
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={onDismiss} aria-label="关闭提示">
          <X className="size-4" />
        </Button>
      </div>
    </aside>
  )

  return typeof document === "undefined" ? node : createPortal(node, document.body)
}
