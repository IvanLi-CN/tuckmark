import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const contractRoot = path.join(repositoryRoot, "compatibility")

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(contractRoot, relativePath), "utf8"))
}

const manifest = await readJson("manifest.v1.json")

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

function contractHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")
}

const approvedHashes = {
  cliBehavior: "1938785aba11b000812d00fbdf4ba411be8032a4be6718278e900cedb7f21b39",
  cliCommands: "4b78ea7fc795443ff1496782a4ae71a41542efa3ec5f8694046cba2b0f1b73a6",
  httpBehavior: "6a6aefd327361cb7b59cab5ee03c3f1f4044d615c6c02b86b3b429633311956b",
  httpRoutes: "d01c864145c43bec3db0b5e62e27e8f05daba9b6d2e50993673a8859e368db72",
  ipcRules: "358af8b90a671ac20a05ecdf29521ab878a8f5467935a667a3df6800ffd4bd71",
  persistedSchemas: "f0fb8ee6a411b721f61469150a1e4e575a4e4418c4515e12c8440ff80743df12",
}

const approvedFixtureHashes = {
  "fixtures/cli-output.json": "5c099be96123b0cfcd7dca667bcc34815db1090a8537f8b6218936c7bd0f3c29",
  "fixtures/http.json": "e21ad28ed57dd9f9ab36195bc7b9bcc9caac00d58d8de6a815aa883fef28ad18",
  "fixtures/sse.json": "9072d0de89296754864bc8ab551821a38d7adb1c85190c194caef7249821b4a6",
  "fixtures/data-tree.json": "8798d09a84ec3348b7fd882e2bd7035ee30933aa95902b9f6ac5aca95fbf4c38",
  "fixtures/interrupted-transaction.json":
    "c466d162b1c805ad04e7360cda9f48484ea9f5561f948d959f78433bd439aabe",
  "fixtures/archive.json": "0d213306e3f53618f0e1f4aa7e3540f25957a9debe3fa0b79a56c2055c2991ce",
  "fixtures/decoded-render.json":
    "f02164e6be76e207b84d89afb419fc614d70eec3ad282e26582fa63766cd289a",
  "fixtures/print-packets.json": "a2897710b8774d68cb189b7325b0e5a0b02f912beb0d6363d7d2415142e183e0",
  "fixtures/release.json": "79de98aa3b54828057ce5dd450764a1c18c373fe129c37228a2f7e46d355541c",
}

for (const [section, expectedHash] of Object.entries(approvedHashes)) {
  assert.equal(
    contractHash(manifest[section]),
    expectedHash,
    `${section} differs from approved parity`
  )
}

assert.equal(manifest.schema, "tuckmark.compatibility-manifest.v1")
assert.equal(manifest.productionAuthority.cli, "rust")
assert.equal(manifest.productionAuthority.devd, "rust")
assert.equal(manifest.persistedSchemaChange, "none")
assert.equal(manifest.cliCommands.length, 36, "approved CLI command count changed")
assert.equal(manifest.httpRoutes.length, 50, "approved HTTP route count changed")
assert.equal(manifest.fixtures.length, 9, "approved fixture category count changed")

for (const collection of ["cliCommands", "httpRoutes", "ipcRules", "persistedSchemas"]) {
  assert.ok(
    Array.isArray(manifest[collection]) && manifest[collection].length > 0,
    `${collection} is empty`
  )
}

function assertUnique(items, key, label) {
  const values = items.map(key)
  assert.equal(new Set(values).size, values.length, `${label} contains duplicates`)
}

assertUnique(manifest.cliCommands, (command) => command.command, "cliCommands")
assertUnique(manifest.httpRoutes, (route) => `${route.method} ${route.path}`, "httpRoutes")
assertUnique(manifest.persistedSchemas, (schema) => schema.name, "persistedSchemas")

for (const command of manifest.cliCommands) {
  assert.ok(Array.isArray(command.flags), `${command.command} flags are missing`)
  assert.ok(command.exitCodes?.success === 0, `${command.command} success exit is not frozen`)
  assert.ok(command.exitCodes?.error === 1, `${command.command} error exit is not frozen`)
}

for (const route of manifest.httpRoutes) {
  assert.match(route.path, /^\//, `${route.method} ${route.path} is not absolute`)
  assert.ok(route.statuses?.length > 0, `${route.method} ${route.path} statuses are missing`)
  assert.ok(route.contentType, `${route.method} ${route.path} content type is missing`)
}

for (const schema of manifest.persistedSchemas) {
  assert.match(schema.name, /^tuckmark\..+\.v1$/, `${schema.name} is not a v1 schema`)
  assert.ok(schema.shape?.length > 0, `${schema.name} shape is missing`)
}

assert.ok(
  manifest.httpRoutes.some((route) => route.transport === "sse"),
  "SSE route is missing"
)

const fixtureKinds = new Set()
for (const fixture of manifest.fixtures) {
  const value = await readJson(fixture.path)
  assert.equal(
    contractHash(value),
    approvedFixtureHashes[fixture.path],
    `${fixture.path} differs from approved golden fixture`
  )
  assert.equal(value.schema, fixture.schema, `${fixture.path} schema does not match manifest`)
  assert.equal(value.synthetic, true, `${fixture.path} must declare synthetic data`)
  fixtureKinds.add(fixture.kind)
  if (fixture.kind === "data-tree") {
    assert.equal(value.entries["manifest.json"].schema, "tuckmark.data-dir-manifest.v1")
    assert.ok(
      value.entries["manifest.json"].files?.inventoryDir,
      "data-tree manifest files are missing"
    )
  }
  if (fixture.kind === "interrupted-transaction") {
    assert.equal(value.journal.schema, "tuckmark.devd-data-transaction.v1")
    assert.ok(Number.isInteger(value.journal.revision) && value.journal.writes.length > 0)
    assert.equal(value.journal.event.revision, value.journal.revision)
  }
  if (fixture.kind === "archive") {
    assert.equal(value.entries["archive.json"].schema, "tuckmark.runtime-export-archive.v1")
    assert.equal(value.entries["manifest.json"].schema, "tuckmark.data-dir-manifest.v1")
  }
  if (fixture.kind === "decoded-render") {
    assert.equal(value.decoded.pixelFormat, "1bpp-msb-first")
    assert.equal(value.decoded.rowsHex.length, value.artifact.height)
  }
  if (fixture.kind === "print-packets") {
    assert.ok(
      Object.values(value.packets).every((group) => Array.isArray(group) && group.length > 0)
    )
  }
  if (fixture.kind === "release") {
    assert.deepEqual(value.releaseNotesSections, ["Included Change", "Release Metadata", "Bundles"])
  }
}

for (const kind of [
  "cli-output",
  "http",
  "sse",
  "data-tree",
  "interrupted-transaction",
  "archive",
  "decoded-render",
  "print-packets",
  "release",
]) {
  assert.ok(fixtureKinds.has(kind), `missing ${kind} fixture`)
}

console.log(
  `Compatibility contract valid: ${manifest.cliCommands.length} CLI commands, ${manifest.httpRoutes.length} HTTP routes, ${manifest.fixtures.length} fixtures.`
)
