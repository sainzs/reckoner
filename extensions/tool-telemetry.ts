import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * Tool telemetry: tracks execution times and injects timing info
 * into slow tool results so the model can make smarter decisions.
 *
 * Inspired by Factory's approach: "Making the LLMs aware of the tool
 * and session run time gives the LLM a concrete sense of tool runtime
 * so it can avoid repeating slow operations."
 *
 * Only surfaces timing when it exceeds thresholds — silence means fast.
 */

const SLOW_THRESHOLD_MS = 5_000     // 5s — inject timing into result
const VERY_SLOW_THRESHOLD_MS = 15_000  // 15s — inject + warn

interface ToolTiming {
  toolName: string
  startTime: number
}

export default function toolTelemetryExtension(pi: ExtensionAPI) {
  const active = new Map<string, ToolTiming>()
  const history: { tool: string, ms: number }[] = []

  pi.on("tool_execution_start", async (event: any) => {
    active.set(event.toolCallId, {
      toolName: event.toolName,
      startTime: Date.now(),
    })
  })

  pi.on("tool_result", async (event: any) => {
    const timing = active.get(event.toolCallId)
    if (!timing) return
    active.delete(event.toolCallId)

    const elapsed = Date.now() - timing.startTime
    history.push({ tool: timing.toolName, ms: elapsed })

    // Only surface timing when it's slow enough to matter
    if (elapsed < SLOW_THRESHOLD_MS) return

    const seconds = (elapsed / 1000).toFixed(1)
    const content = Array.isArray(event.content) ? [...event.content] : []

    if (elapsed >= VERY_SLOW_THRESHOLD_MS) {
      content.push({
        type: "text" as const,
        text: `\n[⚠ This ${timing.toolName} call took ${seconds}s. Consider: shorter timeouts, simpler commands, or a different approach.]`,
      })
    } else {
      content.push({
        type: "text" as const,
        text: `\n[${timing.toolName}: ${seconds}s]`,
      })
    }

    return { content }
  })

  pi.registerCommand("timing", {
    description: "Show tool execution timing from this session",
    handler: async (_args: string, ctx: any) => {
      if (history.length === 0) {
        ctx.ui.notify("No tool calls recorded yet.", "info")
        return
      }

      // Aggregate by tool
      const byTool = new Map<string, { count: number, totalMs: number, maxMs: number }>()
      for (const entry of history) {
        const agg = byTool.get(entry.tool) ?? { count: 0, totalMs: 0, maxMs: 0 }
        agg.count++
        agg.totalMs += entry.ms
        agg.maxMs = Math.max(agg.maxMs, entry.ms)
        byTool.set(entry.tool, agg)
      }

      const lines = [`Tool timing (${history.length} calls):`]
      for (const [tool, agg] of [...byTool.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)) {
        const avg = (agg.totalMs / agg.count / 1000).toFixed(1)
        const max = (agg.maxMs / 1000).toFixed(1)
        const total = (agg.totalMs / 1000).toFixed(1)
        lines.push(`  ${tool}: ${agg.count}x, avg=${avg}s, max=${max}s, total=${total}s`)
      }

      ctx.ui.notify(lines.join("\n"), "info")
    },
  })
}
