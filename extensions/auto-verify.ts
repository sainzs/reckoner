import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { resolve, relative, dirname, basename } from "node:path"
import { existsSync, writeFileSync, mkdtempSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import type { LessonRecord, VerifyIssue, VerifyResult, VerifySource, VerifyStatusPayload } from "./lib/lesson-types.js"
import { fingerprintLspIssue, fingerprintTestIssue, fingerprintTscIssue, normalizeFilePath } from "./lib/fingerprint.js"
import { diffIssueMaps, issueMap } from "./lib/verify-diff.js"
import { NVIM_INIT_PATH } from "./lib/package-path.js"

interface RunState {
  touchedFiles: Set<string>
  baselineTsc: Map<string, VerifyIssue>
  baselineLspByFile: Map<string, Map<string, VerifyIssue>>
  verifyCycles: number
  pendingLessons: Map<string, LessonRecord>
  resolvedAfterCatch: boolean
  lastResult: VerifyResult | null
}

const MAX_VERIFY_CYCLES = 2
const TSC_TIMEOUT = 30_000
const TEST_TIMEOUT = 30_000
const NVIM_TIMEOUT = 20_000
const NVIM_LSP_WAIT = 12
const MAX_ISSUES_IN_STEER = 12
const VERIFY_LABELS = {
  off: "VERIFY OFF",
  ready: "VERIFY READY",
  running: "VERIFY RUNNING",
  issues: "VERIFY ISSUES",
} as const

const TSC_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"])
const RECKONER_NVIM_INIT = NVIM_INIT_PATH

let enabled = true
let nvimServerSocket: string | null = null

function createRunState(): RunState {
  return {
    touchedFiles: new Set<string>(),
    baselineTsc: new Map<string, VerifyIssue>(),
    baselineLspByFile: new Map<string, Map<string, VerifyIssue>>(),
    verifyCycles: 0,
    pendingLessons: new Map<string, LessonRecord>(),
    resolvedAfterCatch: false,
    lastResult: null,
  }
}

let state = createRunState()

function nowTimestamp(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ")
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function execResult(pi: ExtensionAPI, command: string, args: string[], timeout: number) {
  try {
    const result = await pi.exec(command, args, { timeout })
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      code: typeof result.code === "number" ? result.code : 0,
    }
  } catch (error: any) {
    return {
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? ""),
      code: typeof error?.code === "number" ? error.code : 1,
    }
  }
}

function normalizeTouchedPath(rawPath: string, cwd: string): string {
  const clean = rawPath.replace(/^@/, "")
  return normalizeFilePath(relative(cwd, resolve(cwd, clean)))
}

function getSourceLabel(source: VerifySource): string {
  return source === "tsc" ? "Type" : source === "nvim" ? "LSP" : "Test"
}

function lessonKindForSource(source: VerifySource): LessonRecord["kind"] {
  return source === "test" ? "test" : source === "nvim" ? "lsp" : "type"
}

function preventionForSource(source: VerifySource): string {
  if (source === "test") {
    return "Run the nearest related tests after edits and inspect the failing assertion before making broader changes."
  }
  if (source === "nvim") {
    return "Check file-specific diagnostics before and after edits, especially when relying on editor/LSP state."
  }
  return "Type-check touched code paths after shared type or API changes, and treat new compiler errors as turn-introduced regressions."
}

function summarizeIssue(issue: VerifyIssue): string {
  const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : issue.source
  const code = issue.code ? `${issue.code} ` : ""
  return `${location} ${code}${issue.message}`.trim()
}

function issueToLesson(issue: VerifyIssue, touchedFiles: string[]): LessonRecord {
  const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : issue.source
  return {
    id: randomId("lesson"),
    timestamp: nowTimestamp(),
    category: "mistakes",
    source: "auto-verify",
    kind: lessonKindForSource(issue.source),
    fingerprint: issue.fingerprint,
    files: issue.file ? [issue.file, ...touchedFiles.filter(file => file !== issue.file)] : touchedFiles,
    tags: [issue.source, issue.code ?? "", ...(issue.touchedRelated ? ["touched-file"] : [])].filter(Boolean),
    confidence: issue.touchedRelated ? "high" : "medium",
    summary: `${getSourceLabel(issue.source)} regression after editing ${touchedFiles.join(", ") || "the workspace"}: ${summarizeIssue(issue)}`,
    trigger: touchedFiles.length > 0 ? `Edited: ${touchedFiles.join(", ")}` : undefined,
    symptom: `${location} — ${issue.message}`,
    rootCause: issue.raw,
    prevention: preventionForSource(issue.source),
  }
}

function mergeLessons(existing: Map<string, LessonRecord>, incoming: LessonRecord[]) {
  for (const lesson of incoming) {
    const fingerprint = lesson.fingerprint ?? lesson.id
    const prior = existing.get(fingerprint)
    if (!prior) {
      existing.set(fingerprint, lesson)
      continue
    }

    existing.set(fingerprint, {
      ...prior,
      files: Array.from(new Set([...prior.files, ...lesson.files])),
      tags: Array.from(new Set([...prior.tags, ...lesson.tags])),
      summary: prior.summary,
      symptom: prior.symptom ?? lesson.symptom,
      rootCause: prior.rootCause ?? lesson.rootCause,
      prevention: prior.prevention ?? lesson.prevention,
    })
  }
}

async function runNvimDiagnosticsViaServer(pi: ExtensionAPI, socket: string, file: string): Promise<string[]> {
  try {
    await pi.exec("nvim", [
      "--server", socket,
      "--remote-expr", `execute("edit ${file.replace(/"/g, '\\"')}")`,
    ], { timeout: 5000 })

    for (let attempt = 0; attempt < NVIM_LSP_WAIT; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const result = await pi.exec("nvim", [
        "--server", socket,
        "--remote-expr",
        `luaeval("vim.json.encode(vim.tbl_map(function(d) return {s=d.severity, l=d.lnum+1, m=d.message:sub(1,200)} end, vim.diagnostic.get(0)))")`,
      ], { timeout: 5000 })

      const raw = String(result.stdout ?? "").trim()
      if (!raw || raw === "[]" || raw === "null") continue

      try {
        const diags = JSON.parse(raw) as { s: number, l: number, m: string }[]
        const errors = diags
          .filter(diag => diag.s === 1)
          .map(diag => `L${diag.l}: ${diag.m}`)
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

async function runNvimDiagnosticsSpawn(pi: ExtensionAPI, file: string): Promise<string[]> {
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
      if d.severity == 1 then
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
    const result = await execResult(pi, "nvim", [
      "-u", RECKONER_NVIM_INIT,
      "--headless",
      file,
      "-c", `luafile ${scriptPath}`,
    ], NVIM_TIMEOUT)

    const output = `${result.stdout}${result.stderr}`.trim()
    if (!output) return []
    return output.split(/\r?\n/).filter(Boolean)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
}

async function runNvimDiagnostics(pi: ExtensionAPI, file: string): Promise<string[]> {
  if (nvimServerSocket) {
    return runNvimDiagnosticsViaServer(pi, nvimServerSocket, file)
  }
  return runNvimDiagnosticsSpawn(pi, file)
}

function parseTscIssues(raw: string, touched: Set<string>, cwd: string): VerifyIssue[] {
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const issues: VerifyIssue[] = []

  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/)
    if (!match) continue

    const [, filePath, row, col, code, message] = match
    const rel = normalizeFilePath(relative(cwd, resolve(cwd, filePath)))
    issues.push({
      fingerprint: fingerprintTscIssue({ code, file: rel, message }),
      source: "tsc",
      severity: "error",
      file: rel,
      line: Number(row),
      column: Number(col),
      code,
      message,
      raw: `${code} ${message}`,
      touchedRelated: touched.has(rel),
    })
  }

  return issues
}

function parseLspIssues(lines: string[], file: string, touched: Set<string>): VerifyIssue[] {
  const rel = normalizeFilePath(file)
  const issues: VerifyIssue[] = []
  let client = "lsp"

  for (const line of lines) {
    if (line.startsWith("LSP: ")) {
      client = line.slice(5).trim() || client
      continue
    }

    const errorMatch = line.match(/^(?:\[ERROR\]\s*)?L(\d+):\s*(.+)$/)
    if (!errorMatch) continue

    const [, row, message] = errorMatch
    issues.push({
      fingerprint: fingerprintLspIssue({ file: rel, line: Number(row), message, client }),
      source: "nvim",
      severity: "error",
      file: rel,
      line: Number(row),
      message,
      raw: `${client}: ${message}`,
      touchedRelated: touched.has(rel),
    })
  }

  return issues
}

function parseTestIssues(output: string, testFiles: string[], runner: string): VerifyIssue[] {
  const issues: VerifyIssue[] = []
  const failLines = output.split(/\r?\n/).filter(line => /FAIL|✗|✕|×|Error:|AssertionError|expected|received/i.test(line))

  for (const line of failLines.slice(0, 10)) {
    const file = testFiles[0]
    issues.push({
      fingerprint: fingerprintTestIssue({ file, runner, message: line }),
      source: "test",
      severity: "error",
      file,
      message: line.trim(),
      raw: line.trim(),
      touchedRelated: true,
    })
  }

  return issues
}

function findRelatedTests(filePath: string, cwd: string): string[] {
  const tests: string[] = []
  const dir = dirname(filePath)
  const base = basename(filePath).replace(/\.[^.]+$/, "")
  const candidates = [
    resolve(cwd, dir, `${base}.test.ts`),
    resolve(cwd, dir, `${base}.spec.ts`),
    resolve(cwd, dir, `${base}.test.tsx`),
    resolve(cwd, dir, `${base}.spec.tsx`),
    resolve(cwd, dir, "__tests__", `${base}.test.ts`),
    resolve(cwd, dir, "__tests__", `${base}.spec.ts`),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) tests.push(normalizeFilePath(relative(cwd, candidate)))
  }

  return tests
}

async function detectTestRunner(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  try {
    const result = await execResult(pi, "node", ["-e", `
      const path = ${JSON.stringify(resolve(cwd, "package.json"))}
      try {
        const pkg = require(path)
        const test = pkg.scripts?.test || ''
        if (test.includes('vitest')) console.log('vitest')
        else if (test.includes('jest')) console.log('jest')
        else if (test.includes('mocha')) console.log('mocha')
        else console.log('unknown')
      } catch {
        console.log('unknown')
      }
    `], 5000)
    const runner = result.stdout.trim()
    return runner && runner !== "unknown" ? runner : null
  } catch {
    return null
  }
}

async function captureTscBaseline(pi: ExtensionAPI, cwd: string): Promise<Map<string, VerifyIssue>> {
  if (!existsSync(resolve(cwd, "tsconfig.json"))) return new Map()
  const result = await execResult(pi, "npx", ["tsc", "--noEmit", "--pretty", "false"], TSC_TIMEOUT)
  return issueMap(parseTscIssues(`${result.stdout}${result.stderr}`, new Set<string>(), cwd))
}

function needsLspBaseline(file: string, hasTsConfig: boolean): boolean {
  const ext = file.slice(file.lastIndexOf("."))
  return !hasTsConfig || !TSC_EXTENSIONS.has(ext)
}

async function captureLspBaseline(pi: ExtensionAPI, cwd: string, file: string): Promise<Map<string, VerifyIssue>> {
  const absPath = resolve(cwd, file)
  if (!existsSync(absPath)) return new Map()
  const raw = await runNvimDiagnostics(pi, absPath)
  return issueMap(parseLspIssues(raw, file, new Set([file])))
}

async function runVerification(
  pi: ExtensionAPI,
  ctx: any,
  testRunner: string | null,
  opts?: { manual?: boolean },
): Promise<VerifyResult | null> {
  if (!enabled) return null
  if (state.touchedFiles.size === 0 && !opts?.manual) return null
  if (!opts?.manual && state.verifyCycles >= MAX_VERIFY_CYCLES) return null

  const cwd = ctx.cwd
  const startedAt = Date.now()
  const hasTsConfig = existsSync(resolve(cwd, "tsconfig.json"))
  const touchedFiles = [...state.touchedFiles]

  if (ctx.hasUI) {
    ctx.ui.setStatus("verify", VERIFY_LABELS.running)
  }

  pi.events.emit("reckoner:verify-status", {
    label: VERIFY_LABELS.running,
    level: "running",
    severity: "info",
    summary: {
      introduced: 0,
      resolved: 0,
      touchedFiles: touchedFiles.length,
    },
  } satisfies VerifyStatusPayload)

  let currentTsc = new Map<string, VerifyIssue>()
  if (hasTsConfig) {
    const tsc = await execResult(pi, "npx", ["tsc", "--noEmit", "--pretty", "false"], TSC_TIMEOUT)
    currentTsc = issueMap(parseTscIssues(`${tsc.stdout}${tsc.stderr}`, state.touchedFiles, cwd))
  }

  const currentLspByFile = new Map<string, Map<string, VerifyIssue>>()
  const nonTsFiles = touchedFiles.filter(file => needsLspBaseline(file, hasTsConfig)).slice(0, 3)
  for (const file of nonTsFiles) {
    currentLspByFile.set(file, await captureLspBaseline(pi, cwd, file))
  }

  let testFailures: VerifyIssue[] = []
  if (testRunner) {
    const relatedTests = new Set<string>()
    for (const file of touchedFiles) {
      for (const test of findRelatedTests(file, cwd)) {
        relatedTests.add(test)
      }
    }

    if (relatedTests.size > 0) {
      const testFiles = [...relatedTests].slice(0, 5)
      let args: string[]
      if (testRunner === "vitest") args = ["vitest", "run", ...testFiles, "--reporter=verbose"]
      else if (testRunner === "jest") args = ["jest", "--no-coverage", ...testFiles]
      else args = [testRunner, ...testFiles]

      const testResult = await execResult(pi, "npx", args, TEST_TIMEOUT)
      if (testResult.code !== 0) {
        testFailures = parseTestIssues(`${testResult.stdout}${testResult.stderr}`, testFiles, testRunner)
      }
    }
  }

  const introduced: VerifyIssue[] = []
  const unchanged: VerifyIssue[] = []
  const resolved: VerifyIssue[] = []

  const tscDiff = diffIssueMaps(state.baselineTsc, currentTsc)
  introduced.push(...tscDiff.introduced)
  unchanged.push(...tscDiff.unchanged)
  resolved.push(...tscDiff.resolved)

  for (const [file, currentIssues] of currentLspByFile.entries()) {
    const before = state.baselineLspByFile.get(file) ?? new Map<string, VerifyIssue>()
    const diff = diffIssueMaps(before, currentIssues)
    introduced.push(...diff.introduced)
    unchanged.push(...diff.unchanged)
    resolved.push(...diff.resolved)
  }

  const result: VerifyResult = {
    runId: randomId("verify"),
    cycle: state.verifyCycles + (opts?.manual ? 0 : 1),
    touchedFiles,
    baselineCount: state.baselineTsc.size + [...state.baselineLspByFile.values()].reduce((sum, map) => sum + map.size, 0),
    introduced,
    unchanged,
    resolved,
    testFailures,
    passed: introduced.length === 0 && testFailures.length === 0,
    startedAt,
    finishedAt: Date.now(),
  }

  state.lastResult = result

  const newLessons = [...introduced, ...testFailures].map(issue => issueToLesson(issue, touchedFiles))
  if (newLessons.length > 0) {
    mergeLessons(state.pendingLessons, newLessons)
    state.resolvedAfterCatch = false
    if (!opts?.manual) state.verifyCycles++
    const summary = renderVerifyMessage(result)
    pi.sendMessage(
      { customType: "auto-verify", content: summary, display: true },
      { deliverAs: "steer", triggerTurn: !opts?.manual },
    )
    pi.events.emit("reckoner:lesson-candidate", newLessons)
  } else if (state.pendingLessons.size > 0) {
    state.resolvedAfterCatch = true
  }

  const status = buildVerifyStatus(result, enabled)
  if (ctx.hasUI) {
    ctx.ui.setStatus("verify", status.label)
  }
  pi.events.emit("reckoner:verify-status", status)
  pi.events.emit("reckoner:verify-result", result)

  return result
}

function buildVerifyStatus(result: VerifyResult | null, isEnabled: boolean): VerifyStatusPayload {
  if (!isEnabled) {
    return {
      label: VERIFY_LABELS.off,
      level: "off",
      severity: "muted",
      summary: { introduced: 0, resolved: 0, touchedFiles: 0 },
    }
  }

  if (!result) {
    return {
      label: VERIFY_LABELS.ready,
      level: "ready",
      severity: "ok",
      summary: { introduced: 0, resolved: 0, touchedFiles: 0 },
    }
  }

  const introducedCount = result.introduced.length + result.testFailures.length
  return {
    label: introducedCount > 0 ? VERIFY_LABELS.issues : VERIFY_LABELS.ready,
    level: introducedCount > 0 ? "issues" : "ready",
    severity: introducedCount > 0 ? "warn" : "ok",
    summary: {
      introduced: introducedCount,
      resolved: result.resolved.length,
      touchedFiles: result.touchedFiles.length,
    },
  }
}

function formatIssueLine(issue: VerifyIssue): string {
  const where = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : issue.source
  const code = issue.code ? ` ${issue.code}` : ""
  const tag = issue.source === "test" ? "TEST" : issue.source.toUpperCase()
  return `- [${tag}] ${where}${code} ${issue.message}`.trim()
}

function renderVerifyMessage(result: VerifyResult): string {
  const lines = [
    `AUTO-VERIFY found turn-introduced issues after editing ${result.touchedFiles.join(", ") || "the workspace"}:`,
    "",
  ]

  const primary = [...result.introduced, ...result.testFailures].slice(0, MAX_ISSUES_IN_STEER)
  for (const issue of primary) {
    lines.push(formatIssueLine(issue))
  }

  if (result.resolved.length > 0) {
    lines.push("")
    lines.push(`Resolved since baseline: ${result.resolved.length}`)
  }

  if (result.unchanged.length > 0) {
    lines.push(`Ignored unchanged baseline issues: ${result.unchanged.length}`)
  }

  lines.push("")
  lines.push(
    state.verifyCycles >= MAX_VERIFY_CYCLES
      ? "(max auto-verify cycles reached — fix remaining issues manually)"
      : "Fix these introduced issues before continuing.",
  )

  return lines.join("\n")
}

export default function autoVerifyExtension(pi: ExtensionAPI) {
  let testRunner: string | null = null

  pi.events.on("reckoner:nvim-ready", (data: any) => {
    if (data?.socket) nvimServerSocket = data.socket
  })

  pi.on("session_start", async (_event: any, ctx: any) => {
    testRunner = await detectTestRunner(pi, ctx.cwd)
    const status = buildVerifyStatus(state.lastResult, enabled)
    if (ctx.hasUI) {
      ctx.ui.setStatus("verify", status.label)
    }
    pi.events.emit("reckoner:verify-status", status)
  })

  pi.on("agent_start", async (_event: any, ctx: any) => {
    state = createRunState()
    state.baselineTsc = await captureTscBaseline(pi, ctx.cwd)
  })

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!enabled) return
    if (!["edit", "write", "nvim_format"].includes(event.toolName)) return

    const raw = String((event as any).input?.path ?? "").trim()
    if (!raw) return

    const file = normalizeTouchedPath(raw, ctx.cwd)
    state.touchedFiles.add(file)

    const hasTsConfig = existsSync(resolve(ctx.cwd, "tsconfig.json"))
    if (!needsLspBaseline(file, hasTsConfig)) return
    if (state.baselineLspByFile.has(file)) return

    state.baselineLspByFile.set(file, await captureLspBaseline(pi, ctx.cwd, file))
  })

  pi.on("turn_end", async (_event: any, ctx: any) => {
    await runVerification(pi, ctx, testRunner)
  })

  pi.on("agent_end", async () => {
    if (state.pendingLessons.size === 0) return

    for (const lesson of state.pendingLessons.values()) {
      pi.events.emit("reckoner:lesson", {
        ...lesson,
        resolved: state.resolvedAfterCatch,
        outcome: state.resolvedAfterCatch ? "fixed later in the same agent run" : "still unresolved at agent end",
      } satisfies LessonRecord)
    }
  })

  pi.registerCommand("verify", {
    description: "Toggle auto-verification (on/off) or run/show results",
    handler: async (args: string, ctx: any) => {
      const mode = args.trim().toLowerCase()

      if (mode === "off" || mode === "disable") {
        enabled = false
        ctx.ui.notify("Auto-verify disabled", "warning")
      } else if (mode === "on" || mode === "enable") {
        enabled = true
        ctx.ui.notify("Auto-verify enabled", "info")
      } else if (mode === "run" || mode === "now") {
        const result = await runVerification(pi, ctx, testRunner, { manual: true })
        if (!result) {
          ctx.ui.notify("Nothing to verify yet. Edit a file first or wait for a touched-file baseline.", "info")
        } else if (result.passed) {
          ctx.ui.notify(`Verify clean. Resolved: ${result.resolved.length}. Baseline ignored: ${result.unchanged.length}.`, "info")
        }
      } else if (mode === "last") {
        if (!state.lastResult) {
          ctx.ui.notify("No verification run yet.", "info")
        } else {
          const result = state.lastResult
          ctx.ui.notify([
            `Last verify run: ${result.runId}`,
            `Touched files: ${result.touchedFiles.join(", ") || "(none)"}`,
            `Introduced: ${result.introduced.length + result.testFailures.length}`,
            `Resolved: ${result.resolved.length}`,
            `Ignored baseline issues: ${result.unchanged.length}`,
          ].join("\n"), result.passed ? "info" : "warning")
        }
      } else if (mode === "baseline") {
        ctx.ui.notify([
          `Baseline TSC issues: ${state.baselineTsc.size}`,
          `Baseline LSP files: ${state.baselineLspByFile.size}`,
          `Tracked touched files: ${state.touchedFiles.size}`,
        ].join("\n"), "info")
      } else {
        const runner = testRunner ?? "none detected"
        const cycles = `${state.verifyCycles}/${MAX_VERIFY_CYCLES} cycles used`
        const files = state.touchedFiles.size > 0 ? `tracking ${state.touchedFiles.size} file(s)` : "no files tracked"
        ctx.ui.notify(`Auto-verify: ${enabled ? "enabled" : "disabled"}, ${cycles}, ${files}, test runner: ${runner}`, "info")
      }

      const status = buildVerifyStatus(state.lastResult, enabled)
      if (ctx.hasUI) {
        ctx.ui.setStatus("verify", status.label)
      }
      pi.events.emit("reckoner:verify-status", status)
    },
  })
}
