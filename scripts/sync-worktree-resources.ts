import path from "node:path"

import { copyMissingFile, readSyncManifest, repoRoot } from "./shared.js"

const manifestPath = path.join(repoRoot, "scripts", "worktree-sync.paths")
const mappings = await readSyncManifest(manifestPath)

let copied = 0

for (const mapping of mappings) {
  const sourcePath = path.join(repoRoot, mapping.source)
  const targetPath = path.join(repoRoot, mapping.target)
  if (await copyMissingFile(sourcePath, targetPath)) {
    copied += 1
    console.log(`copied ${mapping.target}`)
  }
}

if (copied === 0) {
  console.log("no missing worktree resources")
}
