import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { resolve, relative, dirname, basename } from "node:path"
import { existsSync } from "node:fs"

/**
 * Auto-verify: runs type checking and related tests after turns that edit files.
 * Catches errors immediately so the agent can self-correct.
 *
 * - Tracks files modified via edit/write tools
 * - On turn_end: runs `tsc --noEmit` if tsconfig.json exists
 * - On turn_end: finds and runs test files near modified files
 * - Injects diagnostic errors as a steering message
 * - Limits to 2 verify cycles per agent run to prevent loops
 * - Emits `reckoner:lesson` via pi.events when errors are caught
 * - Toggle with /verify on|off
 */

let modifiedFiles = new Set<string>()
let verifyCycles = 0
let enabled = true
let caughtErrors: { files: string[], errors: string[], type: "type" | "test" }[] = []
let resolvedCaughtErrors = false

const MAX_VERIFY_CYCLES = 2
const TSC_TIMEOUT = 30_000
const TEST_TIMEOUT = 30_000

function parseTscErrors(raw: string, touched: Set<string>, cwd: string): string[] {
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const errors: string[] = []

  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/)
    if (!match) continue

    const [, filePath, row, col, code, message] = match
    const rel = relative(cwd, resolve(cwd, filePath))
    const isTouched = touched.has(rel) || touched.has(filePath)
    const prefix = isTouched ? "→" : " "
    errors.push(`${prefix} ${rel}(${row},${col}): ${code} ${message}`)
  }

  return errors.slice(0, 15)
}

function findRelatedTests(filePath: string, cwd: string): string[] {
  const tests: string[] = []
  const dir = dirname(filePath)
  const base = basename(filePath, ".ts").replace(/\.tsx?$/, "")

  // Convention: foo.ts → foo.test.ts, foo.spec.ts
  const candidates = [
    resolve(cwd, dir, `${base}.test.ts`),
    resolve(cwd, dir, `${base}.spec.ts`),
    resolve(cwd, dir, `${base}.test.tsx`),
    resolve(cwd, dir, `${base}.spec.tsx`),
    // Also check __tests__ directory
    resolve(cwd, dir, "__tests__", `${base}.test.ts`),
    resolve(cwd, dir, "__tests__", `${base}.spec.ts`),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      tests.push(relative(cwd, candidate))
    }
  }

  return tests
}

async function detectTestRunner(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  // Check package.json for test script to infer runner
  try {
    const result = await pi.exec("node", ["-e", `
      const pkg = require('${resolve(cwd, "package.json")}');
      const test = pkg.scripts?.test || '';
      if (test.includes('vitest')) console.log('vitest');
      else if (test.includes('jest')) console.log('jest');
      else if (test.includes('mocha')) console.log('mocha');
      else console.log('unknown');
    `], { timeout: 5000 })
    const runner = (result.stdout ?? "").trim()
    return runner !== "unknown" ? runner : null
  } catch {
    return null
  }
}

export default function autoVerifyExtension(pi: ExtensionAPI) {
  let testRunner: string | null = null

  pi.on("session_start", async (_event, ctx) => {
    testRunner = await detectTestRunner(pi, ctx.cwd)
    if (ctx.hasUI) {
      ctx.ui.setStatus("verify", enabled ? "verify on" : "verify off")
    }
  })

  pi.on("agent_start", async () => {
    modifiedFiles.clear()
    verifyCycles = 0
    caughtErrors = []
    resolvedCaughtErrors = false
  })

  pi.on("tool_result", async (event) => {
    if (!enabled) return
    if (event.toolName !== "edit" && event.toolName !== "write") return

    const raw = (event as any).input?.path
    if (typeof raw === "string") {
      modifiedFiles.add(raw.replace(/^@/, ""))
    }
  })

  pi.on("turn_end", async (_event, ctx) => {
    if (!enabled) return
    if (modifiedFiles.size === 0) return
    if (verifyCycles >= MAX_VERIFY_CYCLES) return

    const cwd = ctx.cwd
    const diagnostics: string[] = []
    const typeErrors: string[] = []
    const testFailures: string[] = []

    if (ctx.hasUI) {
      ctx.ui.setStatus("verify", "verifying…")
    }

    // --- Type checking ---
    const hasTsConfig = existsSync(resolve(cwd, "tsconfig.json"))
    if (hasTsConfig) {
      try {
        const result = await pi.exec("npx", ["tsc", "--noEmit", "--pretty", "false"], {
          timeout: TSC_TIMEOUT,
        })
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
        const errors = parseTscErrors(output, modifiedFiles, cwd)
        if (errors.length > 0) {
          typeErrors.push(...errors)
          diagnostics.push(`**Type errors (${errors.length}):**`, ...errors)
        }
      } catch {
        // tsc failed to run — don't block the agent
      }
    }

    // --- Related tests ---
    if (testRunner) {
      const relatedTests = new Set<string>()
      for (const file of modifiedFiles) {
        for (const test of findRelatedTests(file, cwd)) {
          relatedTests.add(test)
        }
      }

      if (relatedTests.size > 0) {
        const testFiles = [...relatedTests].slice(0, 5) // cap at 5 test files
        try {
          let args: string[]
          if (testRunner === "vitest") {
            args = ["vitest", "run", ...testFiles, "--reporter=verbose"]
          } else if (testRunner === "jest") {
            args = ["jest", "--no-coverage", ...testFiles]
          } else {
            args = [testRunner, ...testFiles]
          }

          const result = await pi.exec("npx", args, { timeout: TEST_TIMEOUT })
          const output = `${result.stdout ?? ""}${result.stderr ?? ""}`

          // Check for failures
          if (result.code !== 0) {
            // Extract just the failure summary, not the full output
            const failLines = output.split(/\r?\n/).filter(
              (l) => /FAIL|✗|✕|×|Error:|AssertionError|expected|received/i.test(l),
            )
            testFailures.push(...failLines.slice(0, 10))
            diagnostics.push(
              `**Test failures (${testFiles.join(", ")}):**`,
              ...testFailures,
            )
          }
        } catch {
          // Tests failed to run — don't block
        }
      }
    }

    // --- Record what was caught ---
    if (diagnostics.length > 0) {
      const touchedFiles = [...modifiedFiles]
      if (typeErrors.length > 0) {
        caughtErrors.push({ files: touchedFiles, errors: typeErrors.slice(0, 3), type: "type" })
      }
      if (testFailures.length > 0) {
        caughtErrors.push({ files: touchedFiles, errors: testFailures.slice(0, 3), type: "test" })
      }

      resolvedCaughtErrors = false
      verifyCycles++
      const touched = touchedFiles.join(", ")
      const summary = [
        `⚠ Auto-verify after editing ${touched}:`,
        "",
        ...diagnostics,
        "",
        verifyCycles >= MAX_VERIFY_CYCLES
          ? "(max auto-verify cycles reached — fix remaining issues manually)"
          : "Fix these issues before continuing.",
      ].join("\n")

      pi.sendMessage(
        { customType: "auto-verify", content: summary, display: true },
        { deliverAs: "steer", triggerTurn: true },
      )
    }

    if (diagnostics.length === 0 && caughtErrors.length > 0) {
      resolvedCaughtErrors = true
    }

    if (ctx.hasUI) {
      const label = diagnostics.length > 0 ? `verify: issues found` : "verify ✓"
      ctx.ui.setStatus("verify", label)
    }
  })

  pi.on("agent_end", async () => {
    if (caughtErrors.length === 0) return

    // Deduplicate error messages
    const seen = new Set<string>()
    const unique = caughtErrors.filter(e => {
      const key = e.errors.join("|")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Emit terse lessons — one per error group
    for (const err of unique) {
      const files = err.files.slice(0, 3).join(", ")
      const summary = err.errors.map(e => e.trim()).join("; ").slice(0, 200)
      pi.events.emit("reckoner:lesson", {
        type: "auto-verify",
        errorKind: err.type,
        files,
        summary,
        fixed: resolvedCaughtErrors,
        timestamp: Date.now(),
      })
    }
  })

  pi.registerCommand("verify", {
    description: "Toggle auto-verification (on/off) or run manually",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase()

      if (mode === "off" || mode === "disable") {
        enabled = false
        ctx.ui.notify("Auto-verify disabled", "warning")
      } else if (mode === "on" || mode === "enable") {
        enabled = true
        ctx.ui.notify("Auto-verify enabled", "info")
      } else if (mode === "run" || mode === "now") {
        verifyCycles = 0
        // Mark all tracked files for re-verification
        ctx.ui.notify("Running verification…", "info")
      } else {
        const runner = testRunner ?? "none detected"
        const state = enabled ? "enabled" : "disabled"
        const cycles = `${verifyCycles}/${MAX_VERIFY_CYCLES} cycles used`
        const files = modifiedFiles.size > 0 ? `tracking ${modifiedFiles.size} files` : "no files tracked"
        ctx.ui.notify(`Auto-verify: ${state}, ${cycles}, ${files}, test runner: ${runner}`, "info")
      }

      if (ctx.hasUI) {
        ctx.ui.setStatus("verify", enabled ? "verify on" : "verify off")
      }
    },
  })
}
