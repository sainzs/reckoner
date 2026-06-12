import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { resolve, relative, dirname, basename } from "node:path"
import { existsSync, writeFileSync, mkdtempSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"

/**
 * Auto-verify: runs type checking and related tests after turns that edit files.
 * Catches errors immediately so the agent can self-correct.
 *
 * - Tracks files modified via edit/write tools
 * - On turn_end: runs `tsc --noEmit` if tsconfig.json exists
 * - On turn_end: finds and runs test files near modified files
 * - Injects diagnostic errors as a steering message
 * - Limits to 2 verify cycles per agent run to prevent loops
 * - Runs nvim diagnostics on non-TypeScript files (Python, Go, Rust, etc.)
 * - Emits `reckoner:lesson` via pi.events when errors are caught
 * - Toggle with /verify on|off
 */

let modifiedFiles = new Set<string>()
let verifyCycles = 0
let enabled = true
let caughtErrors: { files: string[], errors: string[], type: "type" | "test" }[] = []
let resolvedCaughtErrors = false
let nvimServerSocket: string | null = null

const MAX_VERIFY_CYCLES = 2
const TSC_TIMEOUT = 30_000
const TEST_TIMEOUT = 30_000
const NVIM_TIMEOUT = 20_000
const NVIM_LSP_WAIT = 12

// File extensions covered by tsc (don't also nvim-check these)
const TSC_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"])

const RECKONER_NVIM_INIT = resolve(process.env.HOME ?? "~", "Code/reckoner/nvim/init.lua")

/** Get LSP diagnostics for a file via the persistent nvim server (fast path). */
async function runNvimDiagnosticsViaServer(
  pi: ExtensionAPI,
  socket: string,
  file: string,
): Promise<string[]> {
  try {
    // Open the file in the server
    await pi.exec("nvim", [
      "--server", socket,
      "--remote-expr", `execute("edit ${file.replace(/"/g, '\\"')}")`,
    ], { timeout: 5000 })

    // Poll for diagnostics — LSP may need time to analyze a new file
    for (let attempt = 0; attempt < NVIM_LSP_WAIT; attempt++) {
      await new Promise(r => setTimeout(r, 1000))
      const result = await pi.exec("nvim", [
        "--server", socket,
        "--remote-expr",
        `luaeval("vim.json.encode(vim.tbl_map(function(d) return {s=d.severity, l=d.lnum+1, m=d.message:sub(1,200)} end, vim.diagnostic.get(0)))")`,
      ], { timeout: 5000 })

      const raw = (result.stdout ?? "").trim()
      if (!raw || raw === "[]" || raw === "null") continue

      try {
        const diags = JSON.parse(raw) as { s: number, l: number, m: string }[]
        const errors = diags
          .filter(d => d.s === 1) // ERROR only
          .map(d => `L${d.l}: ${d.m}`)
        if (errors.length > 0) return errors
      } catch {
        continue
      }
    }
    return []
  } catch {
    return []
  }
}

/** Get LSP diagnostics by spawning a fresh headless nvim (slow fallback). */
async function runNvimDiagnosticsSpawn(
  pi: ExtensionAPI,
  file: string,
): Promise<string[]> {
  if (!existsSync(RECKONER_NVIM_INIT)) return []

  const luaCode = `
local attempts = 0
local timer = vim.uv.new_timer()
timer:start(1000, 1000, vim.schedule_wrap(function()
  attempts = attempts + 1
  local diags = vim.diagnostic.get(0)
  if #diags > 0 or attempts > ${NVIM_LSP_WAIT} then
    timer:stop()
    timer:close()
    local errors = {}
    for _, d in ipairs(diags) do
      if d.severity == 1 then -- ERROR only
        table.insert(errors, string.format("L%d: %s", d.lnum + 1, d.message:sub(1, 200)))
      end
    end
    if #errors > 0 then
      io.write(table.concat(errors, "\\n"))
    end
    vim.cmd("qa!")
  end
end))
`

  const dir = mkdtempSync(resolve(tmpdir(), "reckoner-verify-"))
  const scriptPath = resolve(dir, "diag.lua")
  writeFileSync(scriptPath, luaCode, "utf8")

  try {
    const result = await pi.exec("nvim", [
      "-u", RECKONER_NVIM_INIT,
      "--headless",
      file,
      "-c", `luafile ${scriptPath}`,
    ], { timeout: NVIM_TIMEOUT })

    const output = (result.stdout ?? "").trim()
    if (!output) return []
    return output.split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
}

/** Get diagnostics — prefer persistent server, fall back to spawn. */
async function runNvimDiagnostics(
  pi: ExtensionAPI,
  file: string,
): Promise<string[]> {
  if (nvimServerSocket) {
    const result = await runNvimDiagnosticsViaServer(pi, nvimServerSocket, file)
    if (result.length > 0) return result
    // Server returned nothing — could be no errors, or server died.
    // Don't fall back to spawn (which would be slow and redundant).
    return []
  }
  return runNvimDiagnosticsSpawn(pi, file)
}

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

  // Listen for the persistent nvim server
  pi.events.on("reckoner:nvim-ready", (data: any) => {
    if (data?.socket) nvimServerSocket = data.socket
  })

  pi.on("session_start", async (_event, ctx) => {
    testRunner = await detectTestRunner(pi, ctx.cwd)
    if (ctx.hasUI) {
      ctx.ui.setStatus("verify", enabled ? "VERIFY READY" : "VERIFY OFF")
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
      ctx.ui.setStatus("verify", "VERIFY RUNNING")
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

    // --- Nvim diagnostics for non-TypeScript files ---
    const nonTsFiles = [...modifiedFiles].filter(f => {
      const ext = f.slice(f.lastIndexOf("."))
      return !TSC_EXTENSIONS.has(ext) || !hasTsConfig
    })

    if (nonTsFiles.length > 0) {
      // Check up to 3 files to avoid slow nvim startup overhead
      for (const file of nonTsFiles.slice(0, 3)) {
        const absPath = resolve(cwd, file)
        if (!existsSync(absPath)) continue

        const errors = await runNvimDiagnostics(pi, absPath)
        if (errors.length > 0) {
          const rel = relative(cwd, absPath)
          const prefixed = errors.slice(0, 5).map(e => `→ ${rel}:${e}`)
          typeErrors.push(...prefixed)
          diagnostics.push(`**LSP errors in ${rel} (${errors.length}):**`, ...prefixed)
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
        `AUTO-VERIFY detected issues after editing ${touched}:`,
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
      const label = diagnostics.length > 0 ? "VERIFY ISSUES" : "VERIFY READY"
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
        ctx.ui.setStatus("verify", enabled ? "VERIFY READY" : "VERIFY OFF")
      }
    },
  })
}
