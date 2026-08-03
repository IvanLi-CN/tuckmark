import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "./lib/utils.js"

type MarkdownContentProps = {
  value?: string
  className?: string
  emptyText?: string
}

function safeExternalHref(href: string | undefined): string | undefined {
  if (!href) {
    return undefined
  }
  try {
    const url = new URL(href)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

export function MarkdownContent({
  value,
  className,
  emptyText = "未填写设备详细信息。",
}: MarkdownContentProps) {
  const source = value ?? ""
  if (!source.trim()) {
    return (
      <p className={cn("tm-markdown-content tm-markdown-content--empty", className)}>{emptyText}</p>
    )
  }

  return (
    <div className={cn("tm-markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const safeHref = safeExternalHref(href)
            return safeHref ? (
              <a href={safeHref} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            )
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
