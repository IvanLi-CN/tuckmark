#!/usr/bin/env node

import { execFile, spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { HOST_TOOL_TARGETS } from "./build-host-tools.mjs"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(import.meta.dirname, "..")
const execExtension = process.platform === "win32" ? ".exe" : ""

function readOption(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return value
}

async function assertExecutable(filePath) {
  await access(filePath, constants.X_OK)
}

async function readEntries(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(prefix, entry.name)
      if (!entry.isDirectory()) return [relativePath]
      return readEntries(path.join(directory, entry.name), relativePath)
    })
  )
  return nested.flat()
}

async function run(command, args, options = {}) {
  return await execFileAsync(command, args, { encoding: "utf8", ...options })
}

async function waitForHealth(baseUrl, child, childOutput) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const output = childOutput.join("").trim()
      throw new Error(
        `tuckmark-devd exited with ${child.exitCode}${output ? `: ${output}` : ""}`
      )
    }
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
      lastError = new Error(`health returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`tuckmark-devd did not become healthy: ${String(lastError)}`)
}

async function reserveEphemeralPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local port for host-tools verification")
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (child.exitCode === null) child.kill("SIGKILL")
}

function releaseTemplatePackage() {
  return {
    schema: "tuckmark.user-template-package.v1",
    id: "release-smoke-label",
    name: "Release Smoke Label",
    description: "",
    canvas: { width: 192, height: 96 },
    fields: [{ key: "message", label: "Message", defaultValue: "release smoke" }],
    elements: [
      {
        kind: "text",
        key: "message",
        x: 12,
        y: 48,
        width: 168,
        fontSize: 18,
        fontWeight: "normal",
        align: "center",
        maxLines: 1,
        rotation: 0,
      },
    ],
    sampleInput: {},
    renderOptions: { paperType: "gap", printWidthDots: 384, threshold: 80 },
    tags: ["release"],
  }
}

export async function verifyHostTools({ releaseRoot, target, version, sha }) {
  const targetConfig = HOST_TOOL_TARGETS[target]
  if (!targetConfig) throw new Error(`Unsupported host-tools target: ${target}`)
  const expectedRoot = path.join(releaseRoot, `tuckmark-${target}`)
  const binDir = path.join(expectedRoot, "bin")
  const helperDir = path.join(expectedRoot, "libexec", "tuckmark")
  const cli = path.join(binDir, `tuckmark${execExtension}`)
  const devd = path.join(binDir, `tuckmark-devd${execExtension}`)
  const detonger = path.join(helperDir, `tuckmark-detonger${execExtension}`)
  const previewEncoder = path.join(helperDir, `tuckmark-detonger-preview-encoder${execExtension}`)

  const topLevelEntries = await readdir(expectedRoot)
  const expectedTopLevelEntries = ["bin", "libexec", "skills"]
  if (
    topLevelEntries.length !== expectedTopLevelEntries.length ||
    expectedTopLevelEntries.some((entry) => !topLevelEntries.includes(entry))
  ) {
    throw new Error("Host-tools archive must contain only bin, libexec, and skills")
  }

  await Promise.all(
    [cli, devd, detonger, previewEncoder].map((filePath) => assertExecutable(filePath))
  )
  await Promise.all([
    access(path.join(expectedRoot, "skills", "tuckmark-agent-import", "SKILL.md")),
    access(path.join(expectedRoot, "skills", "tuckmark-agent-import", "agents", "openai.yaml")),
    access(path.join(expectedRoot, "skills", "tuckmark-templates", "SKILL.md")),
    access(path.join(expectedRoot, "skills", "tuckmark-templates", "agents", "openai.yaml")),
  ])

  const entries = await readEntries(expectedRoot)
  if (entries.some((entry) => entry.split(path.sep).includes("node_modules"))) {
    throw new Error("Host-tools archive must not contain node_modules")
  }
  if (
    entries.some(
      (entry) =>
        entry.includes("tuckmark-agent-import-source") ||
        entry.includes("tuckmark-templates-source")
    )
  ) {
    throw new Error("Host-tools archive must not include source-checkout Skills")
  }

  const expectedVersion = `${version} ${sha} ${targetConfig.targetTriple}`
  const [{ stdout: cliVersion }, { stdout: devdVersion }] = await Promise.all([
    run(cli, ["--version"]),
    run(devd, ["--version"]),
  ])
  if (cliVersion.trim() !== expectedVersion || devdVersion.trim() !== expectedVersion) {
    throw new Error(`Release metadata did not match ${expectedVersion}`)
  }
  await Promise.all([
    run(cli, ["--help"]),
    run(detonger, ["--help"]),
    run(previewEncoder, ["--help"]),
  ])

  if (process.platform === "darwin") {
    await Promise.all(
      [cli, devd, detonger, previewEncoder].map((filePath) =>
        run("codesign", ["--verify", "--strict", filePath])
      )
    )
  }

  const smokeRoot = await mkdtemp(path.join(os.tmpdir(), "tuckmark-host-tools-smoke-"))
  const port = await reserveEphemeralPort()
  const instance = `release-smoke-${process.pid}`
  const env = {
    ...process.env,
    PATH: "",
    PORT: String(port),
    TUCKMARK_DATA_DIR: path.join(smokeRoot, "data"),
    TUCKMARK_DEVD_INSTANCE: instance,
    TUCKMARK_ENABLE_SERVER_SIDE_PRINT: "true",
    XDG_RUNTIME_DIR: path.join(smokeRoot, "runtime"),
  }
  await mkdir(env.XDG_RUNTIME_DIR, { recursive: true })
  const packagePath = path.join(smokeRoot, "release-smoke.package.json")
  await writeFile(packagePath, `${JSON.stringify(releaseTemplatePackage())}\n`, "utf8")

  const childOutput = []
  const child = spawn(devd, [], { cwd: smokeRoot, env, stdio: "pipe" })
  child.stdout?.on("data", (chunk) => childOutput.push(String(chunk)))
  child.stderr?.on("data", (chunk) => childOutput.push(String(chunk)))
  try {
    const baseUrl = `http://127.0.0.1:${port}`
    await waitForHealth(baseUrl, child, childOutput)
    const [rootPage, deepLink, serviceWorker] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/release-smoke/deep-link`),
      fetch(`${baseUrl}/sw.js`),
    ])
    if (!rootPage.ok || !deepLink.ok || !serviceWorker.ok) {
      throw new Error("Embedded Web asset request failed")
    }
    if ((await rootPage.text()) !== (await deepLink.text())) {
      throw new Error("Embedded Web deep link did not fall back to index.html")
    }
    if (!(await serviceWorker.text()).includes("service")) {
      throw new Error("Embedded service worker was not served")
    }
    const { stdout } = await run(cli, ["template-package", "packets", "--file", packagePath], {
      cwd: smokeRoot,
      env,
    })
    if (!JSON.parse(stdout).packets?.packetCount) {
      throw new Error("Packaged CLI did not encode detonger packets")
    }
  } finally {
    await stop(child)
    await rm(smokeRoot, { recursive: true, force: true })
  }

  return { releaseRoot: expectedRoot, target, version, sha }
}

async function main() {
  const releaseRoot = path.resolve(rootDir, readOption("--release-root", "work/host-tools"))
  const target = readOption("--target")
  const version = readOption("--version")
  const sha = readOption("--sha")
  console.log(JSON.stringify(await verifyHostTools({ releaseRoot, target, version, sha }), null, 2))
}

if (import.meta.main) {
  await main()
}
