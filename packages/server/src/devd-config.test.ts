import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  DevdConfigService,
  resolveDefaultDataDirectory,
  resolveDevdConfigPath,
} from "./devd-config.js"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => rm(item, { recursive: true, force: true })))
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuckmark-devd-config-"))
  cleanup.push(root)
  return root
}

describe("DEVD configuration", () => {
  it("uses Documents/Tuckmark and the platform configuration directory", () => {
    expect(
      resolveDefaultDataDirectory({ platform: "darwin", homeDir: "/Users/mock", env: {} })
    ).toBe("/Users/mock/Documents/Tuckmark")
    expect(resolveDevdConfigPath({ platform: "darwin", homeDir: "/Users/mock", env: {} })).toBe(
      "/Users/mock/Library/Application Support/Tuckmark/devd.json"
    )
    expect(resolveDevdConfigPath({ platform: "linux", homeDir: "/home/mock", env: {} })).toBe(
      "/home/mock/.config/tuckmark/devd.json"
    )
  })

  it("honors the Linux XDG documents directory", async () => {
    const root = await createRoot()
    const configHome = path.join(root, "config")
    await mkdir(configHome)
    await writeFile(
      path.join(configHome, "user-dirs.dirs"),
      'XDG_DOCUMENTS_DIR="$HOME/Files"\n',
      "utf8"
    )
    expect(
      resolveDefaultDataDirectory({
        platform: "linux",
        homeDir: root,
        env: { XDG_CONFIG_HOME: configHome },
      })
    ).toBe(path.join(root, "Files", "Tuckmark"))
  })

  it("persists the formal default on first startup", async () => {
    const root = await createRoot()
    const documentsDir = path.join(root, "Documents")
    const configDir = path.join(root, "config")
    const service = new DevdConfigService({ env: {}, documentsDir, configDir })

    expect(service.resolveStartupDataDirectory()).toBe(path.join(documentsDir, "Tuckmark"))
    expect(service.status()).toMatchObject({
      activeSource: "default",
      activeDataDir: path.join(documentsDir, "Tuckmark"),
      savedDataDir: path.join(documentsDir, "Tuckmark"),
      restartRequired: false,
    })
    expect(JSON.parse(await readFile(path.join(configDir, "devd.json"), "utf8"))).toEqual({
      schema: "tuckmark.devd-config.v1",
      dataDir: path.join(documentsDir, "Tuckmark"),
    })
  })

  it("lets the environment override saved configuration without persisting it", async () => {
    const root = await createRoot()
    const configDir = path.join(root, "config")
    const savedDir = path.join(root, "saved")
    const environmentDir = path.join(root, "environment")
    await mkdir(configDir)
    await writeFile(
      path.join(configDir, "devd.json"),
      `${JSON.stringify({ schema: "tuckmark.devd-config.v1", dataDir: savedDir })}\n`,
      "utf8"
    )
    const service = new DevdConfigService({
      env: { TUCKMARK_DATA_DIR: environmentDir },
      documentsDir: path.join(root, "Documents"),
      configDir,
    })

    expect(service.resolveStartupDataDirectory()).toBe(environmentDir)
    expect(service.status()).toMatchObject({
      activeSource: "environment",
      savedDataDir: savedDir,
      restartRequired: true,
    })
    expect(JSON.parse(await readFile(path.join(configDir, "devd.json"), "utf8"))).toMatchObject({
      dataDir: savedDir,
    })
  })

  it("persists a new directory and requires restart without migrating data", async () => {
    const root = await createRoot()
    const activeDir = path.join(root, "active")
    const nextDir = path.join(root, "next")
    const service = new DevdConfigService({
      env: { TUCKMARK_DATA_DIR: activeDir },
      documentsDir: path.join(root, "Documents"),
      configDir: path.join(root, "config"),
    })
    service.resolveStartupDataDirectory()

    expect(service.saveDataDirectory(nextDir)).toMatchObject({
      activeDataDir: activeDir,
      savedDataDir: nextDir,
      restartRequired: true,
    })
  })

  it("accepts a Tuckmark directory that only has the durable owner marker", async () => {
    const root = await createRoot()
    const dataDir = path.join(root, "data")
    await mkdir(path.join(dataDir, ".tuckmark"), { recursive: true })
    await writeFile(
      path.join(dataDir, ".tuckmark", "devd-owner.json"),
      JSON.stringify({ schema: "tuckmark.devd-owner.v1" }),
      "utf8"
    )
    const service = new DevdConfigService({
      env: { TUCKMARK_DATA_DIR: dataDir },
      documentsDir: path.join(root, "Documents"),
      configDir: path.join(root, "config"),
    })

    expect(service.resolveStartupDataDirectory()).toBe(dataDir)
  })

  it("rejects a non-empty unrecognized directory", async () => {
    const root = await createRoot()
    const invalidDir = path.join(root, "invalid")
    await mkdir(invalidDir)
    await writeFile(path.join(invalidDir, "unrelated.txt"), "keep", "utf8")
    const service = new DevdConfigService({
      env: { TUCKMARK_DATA_DIR: path.join(root, "active") },
      documentsDir: path.join(root, "Documents"),
      configDir: path.join(root, "config"),
    })
    service.resolveStartupDataDirectory()

    expect(() => service.saveDataDirectory(invalidDir)).toThrow(/not a recognized Tuckmark/)
    expect(await readFile(path.join(invalidDir, "unrelated.txt"), "utf8")).toBe("keep")
  })

  it("rejects a relative saved directory", async () => {
    const root = await createRoot()
    const service = new DevdConfigService({
      env: { TUCKMARK_DATA_DIR: path.join(root, "active") },
      documentsDir: path.join(root, "Documents"),
      configDir: path.join(root, "config"),
    })
    service.resolveStartupDataDirectory()

    expect(() => service.saveDataDirectory("relative/data")).toThrow(/absolute path/)
  })
})
