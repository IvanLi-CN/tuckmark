#!/usr/bin/env node

import { execFile } from "node:child_process"
import { access, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const releasedSkills = ["tuckmark-agent-import", "tuckmark-templates"]

function readOption(name) {
  const index = process.argv.indexOf(name)
  const value = process.argv[index + 1]
  if (index === -1 || !value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

export async function verifyReleaseSkills(releaseRoot) {
  const home = await mkdtemp(path.join(os.tmpdir(), "tuckmark-release-skills-"))
  try {
    await execFileAsync(
      "npx",
      [
        "--yes",
        "skills",
        "add",
        releaseRoot,
        "--skill",
        "tuckmark-agent-import",
        "--skill",
        "tuckmark-templates",
        "-g",
        "-y",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: path.join(home, ".config"),
          npm_config_cache: path.join(home, ".npm"),
        },
      }
    )

    const installedRoot = path.join(home, ".agents", "skills")
    const installedEntries = await readdir(installedRoot)
    if (
      installedEntries.length !== releasedSkills.length ||
      releasedSkills.some((skill) => !installedEntries.includes(skill))
    ) {
      throw new Error("Only the two released Skills must be installed from a host-tools archive")
    }
    await Promise.all(
      releasedSkills.flatMap((skill) => [
        access(path.join(installedRoot, skill, "SKILL.md")),
        access(path.join(installedRoot, skill, "agents", "openai.yaml")),
      ])
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  await verifyReleaseSkills(path.resolve(readOption("--release-root")))
}
