#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const HOST_TOOL_TARGETS = {
  "darwin-arm64": {
    bunTarget: "bun-darwin-arm64",
    extension: "",
    sign: true,
    targetTriple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    bunTarget: "bun-darwin-x64",
    extension: "",
    sign: true,
    targetTriple: "x86_64-apple-darwin",
  },
  "linux-x64": {
    bunTarget: "bun-linux-x64-baseline",
    extension: "",
    sign: false,
    targetTriple: "x86_64-unknown-linux-gnu",
  },
  "windows-x64": {
    // The Windows runner is already the target platform; cross-target extraction
    // is unreliable in Bun 1.3.14 on the hosted runner.
    bunTarget: null,
    extension: ".exe",
    sign: false,
    targetTriple: "x86_64-pc-windows-msvc",
  },
}

export function assertBuildOutputDirectory(outputDirectory) {
  const workDirectory = path.join(rootDir, "work")
  if (
    outputDirectory === workDirectory ||
    !outputDirectory.startsWith(`${workDirectory}${path.sep}`)
  ) {
    throw new Error("Host-tools output must be a dedicated directory under work/")
  }
}

function readOption(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return value
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit", ...options })
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(root, entry.name)
      if (entry.isDirectory()) return listFiles(absolutePath)
      return [absolutePath]
    })
  )
  return files.flat()
}

function relativeImport(from, to) {
  const value = path.relative(from, to).replaceAll(path.sep, "/")
  return value.startsWith(".") ? value : `./${value}`
}

function buildDefines({ version, sha, target }) {
  return [
    `--define=__TUCKMARK_VERSION__=${JSON.stringify(version)}`,
    `--define=__TUCKMARK_BUILD_SHA__=${JSON.stringify(sha)}`,
    `--define=__TUCKMARK_TARGET__=${JSON.stringify(target)}`,
  ]
}

export async function buildHostTools({
  target,
  outDir,
  version = process.env.TUCKMARK_RELEASE_VERSION || "0.1.0-dev",
  sha = process.env.TUCKMARK_BUILD_SHA || "unknown",
}) {
  const targetConfig = HOST_TOOL_TARGETS[target]
  if (!targetConfig) throw new Error(`Unsupported host-tools target: ${target}`)

  const resolvedOutput = path.resolve(rootDir, outDir)
  assertBuildOutputDirectory(resolvedOutput)
  const stagingRoot = path.join(resolvedOutput, `tuckmark-${target}`)
  const generatedDir = path.join(resolvedOutput, ".generated")
  const binDir = path.join(stagingRoot, "bin")
  const helperDir = path.join(stagingRoot, "libexec", "tuckmark")
  const skillDir = path.join(stagingRoot, "skills")
  const extension = targetConfig.extension

  await rm(resolvedOutput, { recursive: true, force: true })
  await Promise.all([mkdir(binDir, { recursive: true }), mkdir(helperDir, { recursive: true })])

  run("bun", ["run", "build:packages"])
  run("bun", ["run", "--filter", "@tuckmark/web", "build"], {
    env: {
      ...process.env,
      TUCKMARK_APP_VERSION: version.replace(/^v/, ""),
      TUCKMARK_BUILD_REF: sha,
    },
  })
  const webRoot = path.join(rootDir, "apps", "web", "dist")
  const webFiles = await listFiles(webRoot)
  if (webFiles.length === 0) throw new Error("Web build produced no files for DEVD embedding")

  await mkdir(generatedDir, { recursive: true })
  const serverEntry = path.join(generatedDir, "tuckmark-devd-entry.ts")
  const embeddedImports = webFiles
    .map(
      (filePath) =>
        `import ${JSON.stringify(relativeImport(generatedDir, filePath))} with { type: "file" };`
    )
    .join("\n")
  await writeFile(
    serverEntry,
    `${embeddedImports}\nimport ${JSON.stringify(relativeImport(generatedDir, path.join(rootDir, "packages/server/src/entry.ts")))};\n`,
    "utf8"
  )

  const defines = buildDefines({ version, sha, target: targetConfig.targetTriple })
  const compileTargetArgs = targetConfig.bunTarget ? [`--target=${targetConfig.bunTarget}`] : []
  run("bun", [
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    ...compileTargetArgs,
    ...defines,
    path.join(rootDir, "packages", "cli", "src", "index.ts"),
    "--outfile",
    path.join(binDir, `tuckmark${extension}`),
  ])
  run("bun", [
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    ...compileTargetArgs,
    "--asset-naming=[dir]/[name].[ext]",
    ...defines,
    serverEntry,
    "--outfile",
    path.join(binDir, `tuckmark-devd${extension}`),
  ])
  run("cargo", ["build", "--release", "-p", "detonger"], { cwd: path.join(rootDir, "detonger") })
  run("cargo", [
    "build",
    "--release",
    "--manifest-path",
    "tools/detonger-preview-encoder/Cargo.toml",
  ])
  await cp(
    path.join(rootDir, "detonger", "target", "release", `detonger${extension}`),
    path.join(helperDir, `tuckmark-detonger${extension}`)
  )
  await cp(
    path.join(
      rootDir,
      "tools",
      "detonger-preview-encoder",
      "target",
      "release",
      `tuckmark-detonger-preview-encoder${extension}`
    ),
    path.join(helperDir, `tuckmark-detonger-preview-encoder${extension}`)
  )
  await Promise.all([
    cp(
      path.join(rootDir, "skills", "tuckmark-agent-import"),
      path.join(skillDir, "tuckmark-agent-import"),
      {
        recursive: true,
      }
    ),
    cp(
      path.join(rootDir, "skills", "tuckmark-templates"),
      path.join(skillDir, "tuckmark-templates"),
      {
        recursive: true,
      }
    ),
  ])

  if (targetConfig.sign) {
    for (const name of ["tuckmark", "tuckmark-devd"]) {
      const executable = path.join(binDir, name)
      run("codesign", ["--force", "--sign", "-", executable])
      run("codesign", ["--verify", "--strict", executable])
    }
    for (const name of ["tuckmark-detonger", "tuckmark-detonger-preview-encoder"]) {
      const helper = path.join(helperDir, name)
      run("codesign", ["--force", "--sign", "-", helper])
      run("codesign", ["--verify", "--strict", helper])
    }
  }

  return { stagingRoot, target, targetTriple: targetConfig.targetTriple, version, sha }
}

async function main() {
  const target = readOption("--target")
  const outDir = readOption("--out-dir", "work/host-tools")
  const version = readOption("--version", process.env.TUCKMARK_RELEASE_VERSION || "0.1.0-dev")
  const sha = readOption("--sha", process.env.TUCKMARK_BUILD_SHA || "unknown")
  console.log(JSON.stringify(await buildHostTools({ target, outDir, version, sha }), null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}
