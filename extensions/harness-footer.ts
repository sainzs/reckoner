import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { AssistantMessage } from "@mariozechner/pi-ai"
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui"
import {
  type ActivityKind,
  activityForTool,
  type Cell,
  fieldCells,
  trailCells,
  verbFor,
  VERB_WIDTH,
  wellCells,
} from "./lib/footer-ink.js"
import type { NvimStatusPayload, TaskState, VerifyResult, VerifyStatusPayload, WorkspaceState } from "./lib/lesson-types.js"

/**
 * Harness footer: one quiet line that shows what the harness is doing.
 *
 * Design history: a two-line "horizon" gauge, a 3270-style status lamp, a
 * freestanding breath dot, a clock, and a plain block-battery gauge were each
 * tried and set aside. Then a single free-running ink drop, which looked alive
 * but said nothing: it breathed at exactly the same rate whether the model was
 * streaming, wedged on a network call, or asleep. Lessons kept: words over
 * symbols; one line over two; no glyph mistakable for punctuation; no
 * information the OS already shows; and — the expensive one — motion that never
 * stops is motion that stops meaning anything.
 *
 * One idea: everything is ink, and the ink does the work the harness is doing.
 *   the field  — three cells at the far left, one animation per kind of work:
 *                thinking pools, the tape advances per token chunk, reading
 *                scans a line, searching sweeps, fetching goes out to the wire
 *                and waits for a reply, editing lays ink down, running
 *                reciprocates, recalling surfaces, compaction settles. The
 *                vocabulary and its reasoning live in lib/footer-ink.ts.
 *   the verb   — the activity in dim lowercase, in a fixed-width slot, so the
 *                glyphs are learnable and no motion is ever a mystery
 *   the well   — `CONTEXT ⣿⣿⣿⣷⣀⣀`, real remaining context; the surface wobbles
 *                only while tokens are landing, and stills into warning or
 *                error when the ink runs low: stillness as severity
 *   the trail  — `STEPS ⣿⣿⣄⣀`, task progress, fixed width with dry track ahead
 * Labels are silkscreen — uppercase, dim — like the lettering printed on a
 * terminal's chassis. Separators are a single raised ink fleck (⠄) between
 * groups and a plain space within one, so the line reads as groups.
 *
 * Layout: place on the left (path, branch, alerts as plain words), account on
 * the right (session, model, spend, well). True left/right alignment via
 * visibleWidth. Every animated field has a reserved width, because a field that
 * changes size while it animates drags the whole line with it, and that reflow
 * is what reads as jank. As the terminal narrows the right side sheds parts in
 * order — spend, then model, then session — and the well is last to go.
 *
 * Animation policy — terminal/ANSI safe, and honest:
 *   Motion is bound to real events, never to a timer for its own sake. The
 *   render loop only runs while something is happening and is torn down when
 *   the session goes quiet, so an idle harness costs nothing and a still footer
 *   is a true statement. Frames are pure functions of (activity, tick, chunks),
 *   so a re-render cannot advance an animation and a reinstalled footer cannot
 *   reset one. Alerts never blink — urgency is presence, not flashing.
 *
 * Visibility policy — each segment earns its place:
 *   field      — always (what is happening); still and dim when idle
 *   path       — always (where am I)
 *   branch     — always; dirty count when uncommitted changes exist
 *   mode       — ONLY when in plan mode (build is the default; silence = build)
 *   verify     — ONLY when there are new issues (silence = clean)
 *   code intel — ONLY when broken (silence = working)
 *   task       — ONLY when there is an active incomplete task
 *   model/cost — right side, dim (financial and situational awareness)
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

/**
 * What the harness is doing, assembled from the events pi already emits.
 *
 * Deltas are timestamped rather than latched: a provider that stops sending
 * text without closing the message would otherwise leave the tape running
 * forever, and a frozen tape is a lie that looks exactly like a working one.
 */
interface Activity {
  compacting: boolean
  /** Tools currently executing, newest last — a tool can call a tool. */
  tools: Array<{ id: string, name: string }>
  turnInFlight: boolean
  lastTextDelta: number
  lastThinkingDelta: number
  /** Token chunks landed this session; the tape's clock. */
  chunks: number
}

const DELTA_GRACE_MS = 700 // how long after a delta the stream still counts as live
const FRAME_MS = 80 // render cadence while something is moving
const QUIET_MS = 1500 // stillness after the last activity before the loop stops

/** Abbreviate a path for the ledger: home → ~, middle segments → first letter. */
function abbreviatePath(cwd: string): string {
  let p = cwd
  const home = process.env.HOME || process.env.USERPROFILE
  if (home && p.startsWith(home)) p = `~${p.slice(home.length)}`
  const segs = p.split("/")
  if (segs.length <= 3) return p
  const abbreviated = segs.slice(0, -1).map((s, i) => (i === 0 ? s : (s.startsWith(".") ? s.slice(0, 2) : s.charAt(0))))
  return [...abbreviated, segs[segs.length - 1]].join("/")
}

/** Join left and right with padding so the right side sits flush. */
function justify(left: string, right: string, width: number): string {
  const lw = visibleWidth(left)
  const rw = visibleWidth(right)
  if (lw + 2 + rw <= width) {
    return left + " ".repeat(width - lw - rw) + right
  }
  if (lw + 1 <= width) {
    return left + " ".repeat(width - lw) // right side yields entirely
  }
  return truncateToWidth(left, width)
}

/**
 * Shed the least important part of the account side until it fits. Ordered, not
 * all-or-nothing: at sixty columns the well is the one thing still worth having.
 */
function fitAccount(parts: string[], sep: string, budget: number): string {
  const kept = [...parts]
  while (kept.length > 1 && visibleWidth(kept.join(sep)) > budget) {
    kept.shift()
  }
  return kept.join(sep)
}

export default function harnessFooterExtension(pi: ExtensionAPI) {
  let enabled = true
  let active = true
  let installed = false
  const state: FooterState = {}
  const activity: Activity = {
    compacting: false,
    tools: [],
    turnInFlight: false,
    lastTextDelta: 0,
    lastThinkingDelta: 0,
    chunks: 0,
  }

  // The render clock lives out here, not in the footer factory: pi disposes and
  // rebuilds the factory whenever the footer is reinstalled, and an animation
  // whose phase resets every turn never completes a cycle.
  let tick = 0
  let wake: (() => void) | undefined

  /** What is happening, in priority order — the loudest true thing wins. */
  function currentActivity(): ActivityKind {
    if (activity.compacting) return "settling"
    const tool = activity.tools[activity.tools.length - 1]
    if (tool) return activityForTool(tool.name)
    const now = Date.now()
    if (now - activity.lastTextDelta < DELTA_GRACE_MS) return "answering"
    if (now - activity.lastThinkingDelta < DELTA_GRACE_MS) return "thinking"
    // A turn is open but nothing has come back yet: the provider is still
    // composing, which is thinking by any honest reading.
    if (activity.turnInFlight) return "thinking"
    return "idle"
  }

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
    installed = false
    wake = undefined
    try {
      if (ctx.hasUI) ctx.ui.setFooter(undefined)
    } catch {
      // The session may already be replacing/reloading; stale contexts are safe to ignore.
    }
  }

  function paint(theme: any, cells: Cell[]): string {
    return cells.map((c) => theme.fg(c.ink, c.glyph)).join("")
  }

  /**
   * Install the footer once per session. Everything it draws is read live from
   * `state` and `activity`, so it never needs reinstalling to show new data —
   * reinstalling is what used to reset the animation phase every turn.
   */
  function install(ctx: any) {
    if (!active || !enabled || installed) return

    try {
      if (!ctx.hasUI) return
      installed = true
      ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
        const unsub = footerData.onBranchChange(() => tui.requestRender())

        // The loop exists only while there is motion. When the harness goes
        // quiet it is torn down entirely: no timer, no wakeups, no renders.
        let timer: ReturnType<typeof setInterval> | undefined
        let lastMotion = Date.now()

        const stop = () => {
          if (timer) clearInterval(timer)
          timer = undefined
        }

        const start = () => {
          lastMotion = Date.now()
          if (timer) return
          timer = setInterval(() => {
            tick++
            if (currentActivity() !== "idle") lastMotion = Date.now()
            else if (Date.now() - lastMotion > QUIET_MS) stop() // settle, then sleep
            tui.requestRender()
          }, FRAME_MS)
        }

        wake = start
        start()

        return {
          dispose() {
            stop()
            unsub()
            if (wake === start) wake = undefined
          },
          invalidate() {},
          render(width: number): string[] {
            const sep = theme.fg("dim", " ⠄ ")
            const kind = currentActivity()

            let percent: number | null = null
            try {
              percent = ctx.getContextUsage?.()?.percent ?? null
            } catch {}

            // The field and its verb: what is happening, in a reserved slot so
            // nothing downstream moves when the activity changes.
            const field = paint(theme, fieldCells(kind, tick, activity.chunks))
            const verb = theme.fg("dim", verbFor(kind).padEnd(VERB_WIDTH))
            const lead = `  ${field} ${verb}  `

            const leftParts: string[] = []

            // Place — path and branch, always
            let place = abbreviatePath(ctx.sessionManager?.getCwd?.() ?? process.cwd())
            const branch = state.workspace?.branch || footerData.getGitBranch()
            if (branch) {
              const dirty = state.workspace?.dirtyCount ?? 0
              place += `  ${branch}${dirty > 0 ? ` +${dirty}` : ""}`
            }
            leftParts.push(theme.fg("muted", place))

            // Mode — only when plan (build is the silent default)
            if (state.mode?.mode === "plan") {
              leftParts.push(theme.fg("accent", "plan"))
            }

            // Verify — only when there are new issues (steady, no flashing)
            if (state.verify && state.verify.introducedCount > 0) {
              const n = state.verify.introducedCount
              const r = state.verify.resolvedCount
              const fixed = r > 0 ? `, ${r} fixed` : ""
              leftParts.push(theme.fg("warning", `${n} new issue${n === 1 ? "" : "s"}${fixed}`))
            } else if (state.verify?.level === "off") {
              leftParts.push(theme.fg("dim", "verify off"))
            }

            // Code intel — only when NOT working (steady)
            if (state.nvim && !state.nvim.ready) {
              const label = state.nvim.label.replace(/^NVIM\s*/i, "").toLowerCase()
              leftParts.push(theme.fg("warning", `code intel ${label}`))
            }

            // Task — only when active and incomplete; ink laid down per step
            if (state.task && state.task.done < state.task.total) {
              const trail = paint(theme, trailCells(state.task.done, state.task.total))
              leftParts.push(theme.fg("dim", "STEPS ") + trail)
            }

            const left = lead + leftParts.join(sep)

            // Account — session, model, spend, well; flush right, dim
            const rightParts: string[] = []
            const sessionName = ctx.sessionManager?.getSessionName?.()
            if (sessionName) rightParts.push(theme.fg("muted", sessionName))
            const modelId = ctx.model?.id
            if (modelId) rightParts.push(theme.fg("dim", modelId))
            if (state.usage && state.usage.cost > 0) {
              rightParts.push(theme.fg("dim", `$${state.usage.cost.toFixed(2)}`.padStart(6)))
            }
            if (percent !== null) {
              const alive = kind === "answering" || kind === "thinking"
              const well = paint(theme, wellCells(percent, activity.chunks, alive))
              rightParts.push(theme.fg("dim", "CONTEXT ") + well)
            }

            const budget = Math.max(0, width - visibleWidth(left) - 4)
            return [justify(left, fitAccount(rightParts, sep, budget), width)]
          },
        }
      })
    } catch {
      // Ignore stale extension contexts after /reload, /new, /resume, /fork, or /clone.
      active = false
      installed = false
    }
  }

  /** Something happened: make sure the ink is moving again. */
  function nudge() {
    wake?.()
  }

  // ── Activity, from the events pi already emits ────────────────────────

  pi.on("turn_start", async () => {
    activity.turnInFlight = true
    nudge()
  })

  pi.on("turn_end", async (_event: any, ctx: any) => {
    activity.turnInFlight = false
    updateUsage(ctx)
    install(ctx) // no-op once installed; only matters if the footer was toggled off
    nudge()
  })

  pi.on("message_update", async (event: any) => {
    const type = event?.assistantMessageEvent?.type
    if (type === "text_delta" || type === "text_start") {
      activity.chunks++ // the tape advances at the model's pace, not the timer's
      activity.lastTextDelta = Date.now()
      nudge()
    } else if (type === "thinking_delta" || type === "thinking_start") {
      activity.lastThinkingDelta = Date.now()
      nudge()
    }
  })

  pi.on("tool_execution_start", async (event: any) => {
    activity.tools.push({ id: event.toolCallId, name: event.toolName ?? "" })
    nudge()
  })

  pi.on("tool_execution_end", async (event: any) => {
    activity.tools = activity.tools.filter((t) => t.id !== event.toolCallId)
    nudge()
  })

  pi.on("session_before_compact", async () => {
    activity.compacting = true
    nudge()
    return {}
  })

  pi.on("session_compact", async (_event: any, ctx: any) => {
    activity.compacting = false
    updateUsage(ctx)
    nudge()
  })

  // ── Project state, from the harness's own events ───────────────────────

  pi.events.on("reckoner:workspace-updated", (workspace: WorkspaceState) => {
    state.workspace = workspace
    nudge()
  })

  pi.events.on("reckoner:verify-status", (verify: VerifyStatusPayload) => {
    state.verify = { ...verify, introducedCount: 0, resolvedCount: 0 }
    nudge()
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
    nudge()
  })

  pi.events.on("reckoner:nvim-status", (nvim: NvimStatusPayload) => {
    state.nvim = nvim
    nudge()
  })

  pi.events.on("reckoner:mode-changed", (mode: any) => {
    state.mode = mode
    nudge()
  })

  pi.events.on("reckoner:task-updated", (task: TaskState | null) => {
    state.task = task
    nudge()
  })

  pi.on("session_start", async (_event: any, ctx: any) => {
    active = true
    installed = false
    updateUsage(ctx)
    install(ctx)
  })

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    active = false
    clearFooter(ctx)
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
        installed = false
        install(ctx)
        if (ctx.hasUI) ctx.ui.notify("Custom footer enabled", "info")
      }
    },
  })
}
