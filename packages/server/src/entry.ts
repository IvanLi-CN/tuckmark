import { formatReleaseMetadata } from "@tuckmark/core"

import { startServer } from "./index.js"

const command = process.argv[2]

if (command === "--version" || command === "version") {
  console.log(formatReleaseMetadata())
} else {
  startServer()
}
