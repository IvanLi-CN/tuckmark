#!/usr/bin/env node
import { prepareDevelopmentData } from "./dev-data.js"

const args = process.argv.slice(2)
const sourceIndex = args.indexOf("--source")
const explicitSource = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined
if (sourceIndex >= 0 && !explicitSource) throw new Error("--source requires a directory path.")
const unknown = args.filter((arg, index) => {
  if (arg === "--refresh" || arg === "--source") return false
  if (sourceIndex >= 0 && index === sourceIndex + 1) return false
  return true
})
if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`)

console.log(
  JSON.stringify(
    await prepareDevelopmentData({ explicitSource, refresh: args.includes("--refresh") }),
    null,
    2
  )
)
