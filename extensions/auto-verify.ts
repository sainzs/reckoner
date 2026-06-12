import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { resolve, relative } from "node:path"
import { existsSync } from "node:fs"

/**
 * Auto-verify: runs type checking after turns that edit files.
 * Catches errors immediately so the agent can self-correct.
 *
 * - Tracks files modified via edit/write tools
 * - On turn_end: runs `tsc --noEmit` if tsconfig.json exists
 * - Injects diagnostic errors as a steering message
 * - Limits to 2 verify cycles per agent run to prevent loops
 * - Toggle with /verify on|off
 */

let modifiedFiles = new Set<string>()
let verifyCycles = 0
let enabled = true

const MAX_VERIFY_CYCLES = 2
const TSC_TIMEOUT = 30_000

function parseTscErrors(raw: string, touched: Set<string>, cwd: string): string[] {
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const errors: string[] = []

  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/)
    if (!match) continue

    const [, filePath, row, col, code, message] = match
    const rel = relative(cwd, resolve(cwd, filePath))
    const isTouched = touched.has(rel) || touched.has(filePath)

    // Report all errors, but mark touched files
    const prefix = isTouched ? "→" : " "
    errors.push(`${prefix} ${rel}(${row},${col}): ${code} ${message}`)
  }

  return errors.slice(0, 15)
}

export default function autoVerifyExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("verify", enabled ? "verify on" : "verify off")
    }
  })

  pi.on("agent_start", async () => {
    modifiedFiles.clear()
    verifyCycles = 0
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
    const hasTsConfig = existsSync(resolve(cwd, "tsconfig.json"))
    if (!hasTsConfig) return

    if (ctx.hasUI) {
      ctx.ui.setStatus("verify", "verifying…")
    }

    try {
      const result = await pi.exec("npx", ["tsc", "--noEmit", "--pretty", "false"], {
        timeout: TSC_TIMEOUT,
      })

      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      const errors = parseTscErrors(output, modifiedFiles, cwd)

      if (errors.length > 0) {
        verifyCycles++
        const touched = [...modifiedFiles].join(", ")
        const summary = [
          `⚠ Auto-verify: ${errors.length} type error(s) after editing ${touched}`,
          "",
          ...errors,
          "",
          verifyCycles >= MAX_VERIFY_CYCLES
            ? "(max auto-verify cycles reached — fix remaining errors manually)"
            : "Fix these errors before continuing.",
        ].join("\n")

        pi.sendMessage(
          { customType: "auto-verify", content: summary, display: true },
          { deliverAs: "steer", triggerTurn: true },
        )
      }

      if (ctx.hasUI) {
        const label = errors.length > 0 ? `verify: ${errors.length} errors` : "verify ✓"
        ctx.ui.setStatus("verify", label)
      }
    } catch (err) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("verify", "verify: tsc failed")
      }
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
        modifiedFiles.add("*")
        ctx.ui.notify("Running verification…", "info")
      } else {
        const state = enabled ? "enabled" : "disabled"
        const cycles = `${verifyCycles}/${MAX_VERIFY_CYCLES} cycles used`
        const files = modifiedFiles.size > 0 ? `tracking ${modifiedFiles.size} files` : "no files tracked"
        ctx.ui.notify(`Auto-verify: ${state}, ${cycles}, ${files}`, "info")
      }

      if (ctx.hasUI) {
        ctx.ui.setStatus("verify", enabled ? "verify on" : "verify off")
      }
    },
  })
}
