import { spawn } from "node:child_process"
import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? -1}`))
    })
  })
}

const repoRoot = process.cwd()
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tuckmark-worktree-"))
const worktreePath = path.join(tempRoot, "linked")

const copyIgnore = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".tuckmark",
  "work",
  "playwright-report",
  "test-results",
])

try {
  await run("git", ["worktree", "add", "--detach", worktreePath], repoRoot)
  await cp(repoRoot, worktreePath, {
    recursive: true,
    force: true,
    filter(source) {
      const relative = path.relative(repoRoot, source)
      if (!relative) {
        return true
      }

      const firstSegment = relative.split(path.sep)[0]
      return !copyIgnore.has(firstSegment)
    },
  })
  await run("bun", ["run", "scripts/sync-worktree-resources.ts"], worktreePath)
  await run("bun", ["run", "scripts/sync-worktree-resources.ts"], worktreePath)

  const envLocal = await readFile(path.join(worktreePath, ".env.local"), "utf8")
  if (!envLocal.includes("TUCKMARK_DETONGER_REPO_ROOT")) {
    throw new Error(".env.local was not copied from the bootstrap template")
  }

  console.log("worktree bootstrap smoke passed")
} finally {
  await run("git", ["worktree", "remove", "--force", worktreePath], repoRoot).catch(() => undefined)
  await rm(tempRoot, { recursive: true, force: true })
}
