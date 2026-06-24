const REDIRECT_PARAM = "__tuckmark_redirect__"

export function restoreSpaRedirectLocation(): void {
  if (typeof window === "undefined") {
    return
  }

  const params = new URLSearchParams(window.location.search)
  const redirect = params.get(REDIRECT_PARAM)
  if (!redirect) {
    return
  }

  params.delete(REDIRECT_PARAM)
  const remaining = params.toString()
  const target = decodeURIComponent(redirect)
  const nextUrl = remaining
    ? target.includes("?")
      ? `${target}&${remaining}`
      : `${target}?${remaining}`
    : target

  window.history.replaceState(null, "", nextUrl)
}
