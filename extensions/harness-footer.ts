import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { AssistantMessage } from "@mariozechner/pi-ai"
import { truncateToWidth } from "@mariozechner/pi-tui"

/**
 * Harness footer: unified status line replacing scattered setStatus calls.
 *
 * Layout:
 *   main (clean) │ verify ✓ │ nvim ✓ │ 🔨 build │ turn 3 │ ↑12.3k ↓2.1k $0.042
 *
 * Consolidates status from: workspace-context, auto-verify, nvim-server,
 * plan-mode, git-checkpoint. Adds token usage and cost from session data.
 *
 * Uses ctx.ui.setFooter() with footerData for git branch reactivity.
 * Toggle with /footer command.
 */

export default function harnessFooterExtension(pi: ExtensionAPI) {
  let enabled = true
  let turnCount = 0
  let nvimReady = false

  // Track nvim server state
  pi.events.on("reckoner:nvim-ready", () => { nvimReady = true })

  pi.on("turn_start", async () => { turnCount++ })

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI || !enabled) return
    turnCount = 0
    applyFooter(ctx)
  })

  // Refresh footer after turns to update token counts
  pi.on("turn_end", async (_event, ctx) => {
    if (!ctx.hasUI || !enabled) return
    applyFooter(ctx)
  })

  function applyFooter(ctx: any) {
    ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender())

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const parts: string[] = []

          // Git branch
          const branch = footerData.getGitBranch()
          if (branch) {
            parts.push(theme.fg("dim", branch))
          }

          // Collect extension statuses from footerData
          const statuses: Map<string, string> = footerData.getExtensionStatuses()

          // Verify status
          const verify = statuses.get("verify")
          if (verify) {
            const color = verify.includes("issues") ? "warning"
              : verify.includes("✓") ? "success"
              : "dim"
            parts.push(theme.fg(color, verify))
          }

          // Nvim status
          const nvim = statuses.get("nvim-server") || statuses.get("nvim")
          if (nvim) {
            const color = nvim.includes("✓") ? "success" : "dim"
            parts.push(theme.fg(color, nvim))
          }

          // Plan/build mode
          const mode = statuses.get("mode")
          if (mode) {
            parts.push(theme.fg("accent", mode))
          }

          // Turn count (if agent is running)
          if (turnCount > 0) {
            parts.push(theme.fg("dim", `turn ${turnCount}`))
          }

          // Token usage from session
          let input = 0, output = 0, cost = 0
          try {
            for (const e of ctx.sessionManager.getBranch()) {
              if (e.type === "message" && e.message.role === "assistant") {
                const m = e.message as AssistantMessage
                input += m.usage?.input ?? 0
                output += m.usage?.output ?? 0
                cost += m.usage?.cost?.total ?? 0
              }
            }
          } catch {}

          if (input > 0 || output > 0) {
            const fmt = (n: number) => n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`
            parts.push(theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`))
          }

          // Join with separator, handle truncation
          const sep = theme.fg("dim", " │ ")
          const line = parts.join(sep)
          return [truncateToWidth(line, width)]
        },
      }
    })
  }

  pi.registerCommand("footer", {
    description: "Toggle custom footer on/off",
    handler: async (_args, ctx) => {
      enabled = !enabled
      if (enabled) {
        applyFooter(ctx)
        ctx.ui.notify("Custom footer enabled", "info")
      } else {
        ctx.ui.setFooter(undefined)
        ctx.ui.notify("Default footer restored", "info")
      }
    },
  })
}
