import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const contractRoot = path.join(repositoryRoot, "compatibility")

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(contractRoot, relativePath), "utf8"))
}

const manifest = await readJson("manifest.v1.json")

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
  assert.equal(value.schema, fixture.schema, `${fixture.path} schema does not match manifest`)
  assert.equal(value.synthetic, true, `${fixture.path} must declare synthetic data`)
  fixtureKinds.add(fixture.kind)
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
