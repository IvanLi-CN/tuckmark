import { spawn } from "node:child_process"

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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

await run("git", ["submodule", "update", "--init", "--recursive"])
await run("bun", ["run", "scripts/install-hooks.ts"])
await run("bun", ["run", "scripts/sync-worktree-resources.ts"])
