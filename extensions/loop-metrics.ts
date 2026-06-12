import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { InjectionTrace, LessonRecord, MemorySelectionPayload, PromotionCandidate, VerifyResult } from "./lib/lesson-types.js"

interface MetricEvent {
  timestamp: number
  type: string
  payload: Record<string, unknown>
}

function ensureDir(path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readEvents(path: string): MetricEvent[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line: string) => {
      try {
        return JSON.parse(line) as MetricEvent
      } catch {
        return null
      }
    })
    .filter((event: MetricEvent | null): event is MetricEvent => event !== null)
}

function appendEvent(path: string, event: MetricEvent) {
  ensureDir(path)
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8")
}

function metricsFile(cwd: string): string {
  return join(cwd, ".pi", "metrics", "loop.jsonl")
}

function formatSummary(events: MetricEvent[]): string {
  const verify = events.filter(event => event.type === "verify-result")
  const lessons = events.filter(event => event.type === "lesson")
  const selections = events.filter(event => event.type === "memory-selection")
  const promotions = events.filter(event => event.type === "promotion-candidate")

  const introduced = verify.reduce((sum, event) => sum + Number(event.payload.introduced ?? 0), 0)
  const resolved = verify.reduce((sum, event) => sum + Number(event.payload.resolved ?? 0), 0)
  const despiteRecall = verify.reduce((sum, event) => sum + Number(event.payload.repeatedDespiteRecall ?? 0), 0)
  const cleanAfterRecall = verify.reduce((sum, event) => sum + Number(event.payload.cleanAfterRecall ? 1 : 0), 0)

  return [
    `Metrics events: ${events.length}`,
    `Verify runs: ${verify.length}`,
    `Introduced issues: ${introduced}`,
    `Resolved issues: ${resolved}`,
    `Lessons stored: ${lessons.length}`,
    `Memory selections: ${selections.length}`,
    `Promotions: ${promotions.length}`,
    `Repeated despite recall: ${despiteRecall}`,
    `Clean runs after recall: ${cleanAfterRecall}`,
  ].join("\n")
}

export default function loopMetricsExtension(pi: ExtensionAPI) {
  let cwd = ""
  let path = ""
  let lastSelection: MemorySelectionPayload | null = null

  function log(type: string, payload: Record<string, unknown>) {
    if (!path) return
    appendEvent(path, { timestamp: Date.now(), type, payload })
  }

  pi.on("session_start", async (_event: any, ctx: any) => {
    cwd = ctx.cwd
    path = metricsFile(cwd)
    if (ctx.hasUI) {
      ctx.ui.setStatus("metrics", "metrics on")
    }
  })

  pi.events.on("reckoner:verify-result", (result: VerifyResult) => {
    const recalled = new Set((lastSelection?.matches ?? []).map(match => match.fingerprint).filter(Boolean))
    const introducedIssues = [...result.introduced, ...result.testFailures]
    const repeatedDespiteRecall = introducedIssues.filter(issue => recalled.has(issue.fingerprint)).length
    log("verify-result", {
      runId: result.runId,
      touchedFiles: result.touchedFiles,
      introduced: introducedIssues.length,
      resolved: result.resolved.length,
      repeatedDespiteRecall,
      cleanAfterRecall: (lastSelection?.matches.length ?? 0) > 0 && introducedIssues.length === 0,
      fingerprints: introducedIssues.map(issue => issue.fingerprint),
    })
  })

  pi.events.on("reckoner:lesson", (lesson: LessonRecord) => {
    log("lesson", {
      fingerprint: lesson.fingerprint,
      files: lesson.files,
      repeatCount: lesson.repeatCount ?? 1,
      resolved: lesson.resolved,
      summary: lesson.summary,
    })
  })

  pi.events.on("reckoner:memory-selection", (selection: MemorySelectionPayload) => {
    lastSelection = selection
    log("memory-selection", {
      recentFiles: selection.recentFiles,
      activeTask: selection.activeTask?.title,
      matches: selection.matches.map(match => ({
        category: match.category,
        fingerprint: match.fingerprint,
        score: match.score,
        files: match.files,
      })),
    })
  })

  pi.events.on("reckoner:injection-trace", (trace: InjectionTrace) => {
    log("injection-trace", {
      totalChars: trace.totalChars,
      remainingChars: trace.remainingChars,
      fragments: trace.fragments.map(fragment => fragment.key),
      skipped: trace.skipped.map(fragment => fragment.key),
    })
  })

  pi.events.on("reckoner:promotion-candidate", (candidate: PromotionCandidate) => {
    log("promotion-candidate", candidate as unknown as Record<string, unknown>)
  })

  pi.registerCommand("metrics", {
    description: "Show learning-loop metrics summary or recent events",
    handler: async (args: string, ctx: any) => {
      if (!path) {
        ctx.ui.notify("Metrics not initialized yet.", "info")
        return
      }

      const mode = args.trim().toLowerCase()
      const events = readEvents(path)
      if (events.length === 0) {
        ctx.ui.notify("No metrics recorded yet.", "info")
        return
      }

      if (mode === "recent") {
        ctx.ui.notify(events.slice(-10).map(event => `${new Date(event.timestamp).toLocaleString()} ${event.type} ${JSON.stringify(event.payload)}`).join("\n"), "info")
        return
      }

      if (mode === "repeated") {
        const counts = new Map<string, number>()
        for (const event of events) {
          const fingerprints = Array.isArray(event.payload.fingerprints) ? event.payload.fingerprints : event.payload.fingerprint ? [event.payload.fingerprint] : []
          for (const fingerprint of fingerprints) {
            counts.set(String(fingerprint), (counts.get(String(fingerprint)) ?? 0) + 1)
          }
        }
        const lines = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([fingerprint, count]) => `${count} ${fingerprint}`)
        ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No repeated fingerprints yet.", "info")
        return
      }

      ctx.ui.notify(formatSummary(events), "info")
    },
  })
}
