import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { AssistantMessage } from "@mariozechner/pi-ai"
import { truncateToWidth } from "@mariozechner/pi-tui"
import type { NvimStatusPayload, TaskState, VerifyResult, VerifyStatusPayload, WorkspaceState } from "./lib/lesson-types.js"

/**
 * Harness footer: calm system heartbeat.
 *
 * Visibility policy — each segment earns its place:
 *   branch    — always (you always need to know where you are)
 *   dirty     — when uncommitted changes exist
 *   mode      — ONLY when in plan mode (build is the default; silence = build)
 *   verify    — ONLY when there are new issues (silence = clean)
 *   code intel — ONLY when broken (silence = working)
 *   task      — ONLY when there is an active incomplete task
 *   cost      — when non-zero (financial awareness)
 *
 * Token counts are omitted — they live in /metrics, not the footer.
 */

interface FooterState {
  workspace?: WorkspaceState
  verify?: VerifyStatusPayload & { introducedCount: number, resolvedCount: number }
  nvim?: NvimStatusPayload
  mode?: { mode: "plan" | "build" }
  task?: TaskState | null
  usage?: { cost: number }
}

export default function harnessFooterExtension(pi: ExtensionAPI) {
  let enabled = true
  let active = true
  const state: FooterState = {}

  function updateUsage(ctx: any) {
    let cost = 0
    try {
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === "message" && entry.message.role === "assistant") {
          const m = entry.message as AssistantMessage
          cost += m.usage?.cost?.total ?? 0
        }
      }
    } catch {}
    state.usage = { cost }
  }

  function clearFooter(ctx: any) {
    try {
      if (ctx.hasUI) ctx.ui.setFooter(undefined)
    } catch {
      // The session may already be replacing/reloading; stale contexts are safe to ignore.
    }
  }

  function refresh(ctx: any) {
    if (!active || !enabled) return

    try {
      if (!ctx.hasUI) return
      ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
        const unsub = footerData.onBranchChange(() => tui.requestRender())
        return {
          dispose: unsub,
          invalidate() {},
          render(width: number): string[] {
            const parts: string[] = []
            const sep = theme.fg("dim", "  ·  ")

            // Branch — always show
            const branch = state.workspace?.branch || footerData.getGitBranch()
            if (branch) {
              const dirty = state.workspace?.dirtyCount ?? 0
              const label = dirty > 0 ? `${branch} · ${dirty} changes` : branch
              parts.push(theme.fg("dim", label))
            }

            // Mode — only when plan (build is silent default)
            if (state.mode?.mode === "plan") {
              parts.push(theme.fg("accent", "plan mode"))
            }

            // Verify — only when there are new issues
            if (state.verify && state.verify.introducedCount > 0) {
              const n = state.verify.introducedCount
              const r = state.verify.resolvedCount
              const fixed = r > 0 ? `, ${r} fixed` : ""
              parts.push(theme.fg("warning", `${n} new issue${n === 1 ? "" : "s"}${fixed}`))
            } else if (state.verify?.level === "off") {
              parts.push(theme.fg("dim", "verify off"))
            }

            // Code intel — only when NOT working
            if (state.nvim && !state.nvim.ready) {
              const label = state.nvim.label.replace(/^NVIM\s*/i, "").toLowerCase()
              parts.push(theme.fg("warning", `code intel ${label}`))
            }

            // Task — only when active and incomplete
            if (state.task && state.task.done < state.task.total) {
              const remaining = state.task.total - state.task.done
              const label = remaining === 1 ? "1 step left" : `${remaining} steps left`
              parts.push(theme.fg("dim", label))
            }

            // Cost — only when non-zero
            if (state.usage && state.usage.cost > 0) {
              parts.push(theme.fg("dim", `$${state.usage.cost.toFixed(2)}`))
            }

            if (parts.length === 0) return [""]
            return [truncateToWidth(parts.join(sep), width)]
          },
        }
      })
    } catch {
      // Ignore stale extension contexts after /reload, /new, /resume, /fork, or /clone.
      active = false
    }
  }

  pi.events.on("reckoner:workspace-updated", (workspace: WorkspaceState) => {
    state.workspace = workspace
  })

  pi.events.on("reckoner:verify-status", (verify: VerifyStatusPayload) => {
    state.verify = { ...verify, introducedCount: 0, resolvedCount: 0 }
  })

  pi.events.on("reckoner:verify-result", (result: VerifyResult) => {
    const introduced = result.introduced.length + result.testFailures.length
    const resolved = result.resolved.length
    state.verify = {
      ...(state.verify ?? {
        label: introduced > 0 ? "VERIFY ISSUES" : "VERIFY READY",
        level: introduced > 0 ? "issues" : "ready",
        severity: introduced > 0 ? "warn" : "ok",
        summary: { introduced, resolved, touchedFiles: result.touchedFiles.length },
      }),
      introducedCount: introduced,
      resolvedCount: resolved,
    }
  })

  pi.events.on("reckoner:nvim-status", (nvim: NvimStatusPayload) => {
    state.nvim = nvim
  })

  pi.events.on("reckoner:mode-changed", (mode: any) => {
    state.mode = mode
  })

  pi.events.on("reckoner:task-updated", (task: TaskState | null) => {
    state.task = task
  })

  pi.on("session_start", async (_event: any, ctx: any) => {
    active = true
    updateUsage(ctx)
    refresh(ctx)
  })

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    active = false
    clearFooter(ctx)
  })

  pi.on("turn_end", async (_event: any, ctx: any) => {
    refresh(ctx)
  })

  pi.registerCommand("footer", {
    description: "Toggle custom footer on/off",
    handler: async (args: string, ctx: any) => {
      const mode = args.trim().toLowerCase()
      if (mode === "off") enabled = false
      else if (mode === "on") enabled = true
      else enabled = !enabled

      if (!enabled) {
        clearFooter(ctx)
        if (ctx.hasUI) ctx.ui.notify("Default footer restored", "info")
      } else {
        refresh(ctx)
        if (ctx.hasUI) ctx.ui.notify("Custom footer enabled", "info")
      }
    },
  })
}
