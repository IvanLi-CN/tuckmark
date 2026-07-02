#!/usr/bin/env node

import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()
const outDir = path.resolve(process.argv[2] ?? "work/agent-template-practice")
const cliPath = path.join(repoRoot, "packages/cli/src/index.ts")
const cliTsconfigPath = path.join(repoRoot, "packages/cli/tsconfig.typecheck.json")

const scenarios = [
  {
    id: "component-rating",
    title: "Electronic component rating bin",
    prompt:
      "Create a compact Tuckmark user template package JSON for a small organizer label like 'SS34 / 40V 3A / SMAF'.",
  },
  {
    id: "ic-module",
    title: "IC and module storage bin",
    prompt:
      "Create a compact Tuckmark user template package JSON for an IC/module storage box label like 'ESP32-C3 / 4MB Flash / RISC-V MCU'.",
  },
  {
    id: "sensor-i2c",
    title: "Sensor and I2C module bin",
    prompt:
      "Create a compact Tuckmark user template package JSON for a sensor module label like 'AHT20 / I2C / temperature humidity'.",
  },
  {
    id: "inductor-resistor",
    title: "Inductor and resistor value bin",
    prompt:
      "Create a compact Tuckmark user template package JSON for a passive component label like '4.7uH / 6030 / integrated inductor'.",
  },
]

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function extractJsonObject(text) {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) {
    throw new Error("Codex output did not contain a JSON object")
  }
  return JSON.parse(text.slice(start, end + 1))
}

async function runCodexScenario(scenario) {
  const outputPath = path.join(outDir, `${scenario.id}.last-message.txt`)
  const prompt = [
    "Return only one JSON object. Do not include Markdown.",
    "The JSON must satisfy Tuckmark schema tuckmark.user-template-package.v1.",
    "Use fixed monochrome elements only: text, rect, line, barcode, qr.",
    "Keep canvas.width <= 384 and canvas.height <= 160.",
    "Use schema, id, name, description, canvas, fields, elements, sampleInput, renderOptions, tags.",
    scenario.prompt,
  ].join("\n")

  await execFileAsync(
    "codex",
    ["exec", "--ephemeral", "--sandbox", "read-only", "-a", "never", "-o", outputPath, prompt],
    {
      cwd: repoRoot,
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 8,
    }
  )

  const raw = await readFile(outputPath, "utf8")
  const json = extractJsonObject(raw)
  const packagePath = path.join(outDir, `${scenario.id}.package.json`)
  await writeFile(packagePath, `${JSON.stringify(json, null, 2)}\n`, "utf8")
  return { raw, packagePath }
}

async function runCli(args) {
  const result = await execFileAsync(
    "bun",
    ["tsx", "--tsconfig", cliTsconfigPath, cliPath, ...args],
    {
      cwd: repoRoot,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 8,
      env: {
        ...process.env,
        TUCKMARK_DETONGER_PACKET_ENCODER: "lpapi",
        TUCKMARK_MOCK_PRINTERS: "1",
      },
    }
  )
  return JSON.parse(result.stdout)
}

function evaluatePackage(templatePackage, preview) {
  const textElementCount = templatePackage.elements.filter(
    (element) => element.kind === "text"
  ).length
  const withinWidth = templatePackage.canvas.width <= 384
  const fixedElements = templatePackage.elements.length > 0
  const readable = textElementCount >= 2
  return {
    ok: withinWidth && fixedElements && readable && preview.artifact?.pngPath,
    withinWidth,
    fixedElements,
    readable,
    pngPath: preview.artifact?.pngPath ?? "",
  }
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const rows = []

  for (const scenario of scenarios) {
    const generated = await runCodexScenario(scenario)
    const templatePackage = JSON.parse(await readFile(generated.packagePath, "utf8"))
    const validation = await runCli([
      "template-package",
      "validate",
      "--file",
      generated.packagePath,
    ])
    const preview = await runCli(["template-package", "preview", "--file", generated.packagePath])
    const evaluation = evaluatePackage(templatePackage, preview)
    rows.push({ scenario, packagePath: generated.packagePath, validation, preview, evaluation })
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tuckmark Agent Template Practice Report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #202124; }
    h1 { font-size: 24px; }
    article { border: 1px solid #d7d7d7; border-radius: 8px; padding: 16px; margin: 16px 0; }
    img { image-rendering: pixelated; border: 1px solid #ccc; max-width: 384px; background: white; }
    code { background: #f5f5f5; padding: 2px 4px; border-radius: 4px; }
    .ok { color: #116329; }
    .fail { color: #a40e26; }
  </style>
</head>
<body>
  <h1>Tuckmark Agent Template Practice Report</h1>
  <p>This high-cost practice report uses Codex CLI generation plus Tuckmark CLI validation and preview. It does not support physical printing.</p>
  ${rows
    .map(
      (row) => `<article>
    <h2>${escapeHtml(row.scenario.title)}</h2>
    <p><strong>Status:</strong> <span class="${row.evaluation.ok ? "ok" : "fail"}">${row.evaluation.ok ? "pass" : "review"}</span></p>
    <p><strong>Package:</strong> <code>${escapeHtml(path.relative(repoRoot, row.packagePath))}</code></p>
    <p><strong>Canvas:</strong> ${row.validation.width} x ${row.validation.height}</p>
    <p><strong>Self check:</strong> width=${row.evaluation.withinWidth}; fixedElements=${row.evaluation.fixedElements}; readable=${row.evaluation.readable}</p>
    <img alt="${escapeHtml(row.scenario.title)} preview" src="${escapeHtml(row.preview.artifact.pngPath)}">
  </article>`
    )
    .join("\n")}
</body>
</html>
`

  const reportPath = path.join(outDir, "index.html")
  await writeFile(reportPath, html, "utf8")
  console.log(JSON.stringify({ reportPath, total: rows.length }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
