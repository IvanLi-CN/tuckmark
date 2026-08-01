export function normalizeLoopbackHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "")
}

export function deriveAgentImportWebUrl(args: {
  devdUrl: string
  serverPort: string
  webPort: string
}): string {
  const parsedDevdUrl = new URL(args.devdUrl)
  if (
    ["127.0.0.1", "::1", "localhost"].includes(normalizeLoopbackHostname(parsedDevdUrl.hostname)) &&
    parsedDevdUrl.port === args.serverPort &&
    args.webPort !== args.serverPort
  ) {
    parsedDevdUrl.port = args.webPort
    return parsedDevdUrl.toString().replace(/\/$/u, "")
  }
  return args.devdUrl
}
