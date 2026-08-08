import { ArrowLeft } from "lucide-react"
import type React from "react"

import { ProductMark } from "./components/product-mark.js"
import { Button } from "./components/ui/button.js"

export function returnToDraftProcessingDialog(): void {
  if (typeof window !== "undefined") {
    if (window.opener && !window.opener.closed) {
      window.opener.focus()
    }
    window.close()
  }
}

export function DraftProcessingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tm-draft-processing-shell">
      <header className="tm-draft-processing-header">
        <div className="tm-draft-processing-header__identity">
          <ProductMark compact />
          <div>
            <p className="tm-draft-processing-header__eyebrow">数据替换前置处理</p>
            <h1>草稿处理</h1>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          aria-label="返回草稿处理弹窗"
          onClick={returnToDraftProcessingDialog}
        >
          <ArrowLeft className="size-4" />
          <span>返回</span>
        </Button>
      </header>
      <main className="tm-draft-processing-main">{children}</main>
    </div>
  )
}
