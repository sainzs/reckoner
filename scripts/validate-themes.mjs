#!/usr/bin/env node
// Validates every theme in themes/ against pi's theme schema.
// Run: npm run verify:themes
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const themesDir = join(root, "themes")
const schemaPath = join(
  root,
  "node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
)

const schema = JSON.parse(readFileSync(schemaPath, "utf8"))
const required = new Set(schema.properties.colors.required)
const hexRe = /^#[0-9a-fA-F]{6}$/

const files = readdirSync(themesDir).filter((f) => f.endsWith(".json"))
if (files.length === 0) {
  console.error("no themes found in themes/")
  process.exit(1)
}

let failed = false
for (const file of files) {
  const name = file.replace(/\.json$/, "")
  const t = JSON.parse(readFileSync(join(themesDir, file), "utf8"))
  const keys = new Set(Object.keys(t.colors))
  const vars = t.vars ?? {}
  const problems = []

  if (typeof t.name !== "string" || !t.name) problems.push("missing string \"name\"")
  for (const k of required) if (!keys.has(k)) problems.push(`missing color "${k}"`)
  for (const k of keys) {
    if (required.has(k)) continue
    problems.push(`extra color "${k}"`)
  }
  for (const [k, val] of Object.entries(t.colors)) {
    if (typeof val === "number") {
      if (val < 0 || val > 255) problems.push(`color "${k}" palette index out of range: ${val}`)
    } else if (hexRe.test(val) || val === "" || val in vars) {
      // ok
    } else {
      problems.push(`color "${k}" does not resolve: "${val}" is not hex, a var, or a palette index`)
    }
  }
  for (const [k, val] of Object.entries(vars)) {
    if (typeof val !== "number" && !hexRe.test(val)) {
      problems.push(`var "${k}" is not hex or palette index: ${JSON.stringify(val)}`)
    }
  }

  if (problems.length) {
    failed = true
    console.error(`✗ ${file}`)
    for (const p of problems) console.error(`    ${p}`)
  } else {
    console.log(`✓ ${file} (${keys.size} colors, ${Object.keys(vars).length} vars)`)
  }
}

process.exit(failed ? 1 : 0)
