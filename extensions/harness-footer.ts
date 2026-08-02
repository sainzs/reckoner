import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { AssistantMessage } from "@mariozechner/pi-ai"
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui"
import type { NvimStatusPayload, TaskState, VerifyResult, VerifyStatusPayload, WorkspaceState } from "./lib/lesson-types.js"

/**
 * Harness footer: one quiet line.
 *
 * Design history: a two-line "horizon" gauge, a 3270-style status lamp,
 * a freestanding breath dot, a clock, and a plain block-battery gauge were
 * each tried and set aside. Lessons kept: words over symbols; one line
 * over two; no glyph mistakable for punctuation; no information the OS
 * already shows (the clock).
 *
 * One idea: everything is ink. The footer is written in one braille ink
 * family, and every living element is a spin on the ink well:
 *   the drop   — far left, a bead of ink swelling and settling (~3s),
 *                the signal that the harness is alive
 *   the well   — `context ⣿⣿⣿⣷⣀⣀`, remaining room; solid ink, a surface
 *                that flickers like a candle, sediment where spent
 *   the trail  — `steps ⣿⣿⣄⣀`, task progress; ink laid down per step,
 *                the working edge flickering, dry track ahead
 * Labels are words so no element is ever a mystery, set as silkscreen —
 * uppercase, dim — like the lettering printed on a terminal's chassis
 * (EXECT-100, VT100, VT520): the case is printed, the values are the
 * phosphor. Separators are a single raised ink fleck (⠄), of the same
 * family as the drop at rest.
 *
 * Layout: place on the left (path, branch, work in flight, alerts as
 * plain words), account on the right (session name, model, spend, well).
 * True left/right alignment via visibleWidth; the right side yields as
 * the terminal narrows.
 *
 * Animation policy — terminal/ANSI safe, and calm:
 *   One rhythm, three expressions: the drop swells, the well's surface
 *   flickers, the trail's working edge flickers — all frame-cycles of
 *   plain glyphs re-colored via theme.fg() on one ~250ms tick, cleared
 *   in dispose() so nothing leaks across /reload. Alerts never blink —
 *   they hold a steady color; urgency is presence, not flashing. When
 *   ink runs low the well's surface stills and holds warning (<30% left)
 *   or error (<10% left): stillness as severity.
 *
 * Visibility policy — each segment earns its place:
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

// ── The ink family ───────────────────────────────────────────────────────

// The drop: a bead of ink swelling and settling, dwelling longest at rest.
const DROP_FRAMES: Array<[string, string]> = [
  ["⡀", "dim"],
  ["⡀", "dim"],
  ["⣀", "dim"],
  ["⣤", "muted"],
  ["⣶", "muted"],
  ["⣿", "accent"],
  ["⣶", "muted"],
  ["⣤", "muted"],
  ["⣀", "dim"],
  ["⡀", "dim"],
  ["⡀", "dim"],
  ["⡀", "dim"],
]

function renderDrop(theme: any, tick: number): string {
  const [glyph, color] = DROP_FRAMES[tick % DROP_FRAMES.length]
  return theme.fg(color, glyph)
}

// The surface of wet ink, flickering softly like a candle.
const SURFACE_FRAMES = ["⣶", "⣷", "⣶", "⣾"]

const INK_CELLS = 6

/**
 * The well: remaining context as ink. `context ⣿⣿⣿⣷⣀⣀` — solid ink,
 * a flickering surface cell, sediment where spent. Low ink stills the
 * surface and holds warning/error color instead: stillness as severity.
 */
function renderWell(theme: any, tick: number, percent: number): string {
  const available = Math.max(0, 100 - percent)
  const filled = Math.max(available > 0 ? 1 : 0, Math.round((available / 100) * INK_CELLS))
  const inkColor = available < 10 ? "error" : available < 30 ? "warning" : "muted"
  const calm = inkColor === "muted"
  const surface = calm ? SURFACE_FRAMES[Math.floor(tick / 2) % SURFACE_FRAMES.length] : "⣶"

  let well = ""
  for (let i = 0; i < INK_CELLS; i++) {
    if (i < filled - 1) well += theme.fg(inkColor, "⣿")
    else if (i === filled - 1) well += theme.fg(inkColor, surface)
    else well += theme.fg("dim", "⣀")
  }
  return theme.fg("dim", "CONTEXT ") + well
}

/**
 * The trail: task progress as ink laid down. `steps ⣿⣿⣷⣀` — one cell
 * per step (capped), done steps solid, the working edge flickering,
 * dry track ahead.
 */
function renderTrail(theme: any, tick: number, done: number, total: number): string {
  const cells = Math.min(total, 8)
  const scale = cells / total
  const doneCells = Math.floor(done * scale)

  let trail = ""
  for (let i = 0; i < cells; i++) {
    if (i < doneCells) trail += theme.fg("muted", "⣿")
    else if (i === doneCells) trail += theme.fg("muted", SURFACE_FRAMES[Math.floor(tick / 2) % SURFACE_FRAMES.length])
    else trail += theme.fg("dim", "⣀")
  }
  return theme.fg("dim", "STEPS ") + trail
}

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
        let tick = 0
        const timer = setInterval(() => {
          tick++
          tui.requestRender() // the ink moved one frame
        }, 250)
        return {
          dispose() {
            clearInterval(timer)
            unsub()
          },
          invalidate() {},
          render(width: number): string[] {
            const sep = theme.fg("dim", "  ⠄  ")

            // Context feeds the well on the right side.
            let percent: number | null = null
            try {
              percent = ctx.getContextUsage?.()?.percent ?? null
            } catch {}

            const leftParts: string[] = []

            // The drop — the harness is alive, quietly
            leftParts.push(renderDrop(theme, tick))

            // Place — path and branch, always
            let place = abbreviatePath(ctx.sessionManager?.getCwd?.() ?? process.cwd())
            const branch = state.workspace?.branch || footerData.getGitBranch()
            if (branch) {
              const dirty = state.workspace?.dirtyCount ?? 0
              place += `  ${branch}${dirty > 0 ? ` +${dirty}` : ""}`
            }
            leftParts.push(theme.fg("muted", place))

            // Mode — only when plan (build is silent default)
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
              leftParts.push(renderTrail(theme, tick, state.task.done, state.task.total))
            }

            // Account — session, model, spend, gauge; flush right, dim
            const rightParts: string[] = []
            const sessionName = ctx.sessionManager?.getSessionName?.()
            if (sessionName) rightParts.push(theme.fg("muted", sessionName))
            const modelId = ctx.model?.id
            if (modelId) rightParts.push(theme.fg("dim", modelId))
            if (state.usage && state.usage.cost > 0) {
              rightParts.push(theme.fg("dim", `$${state.usage.cost.toFixed(2)}`))
            }
            if (percent !== null) {
              rightParts.push(renderWell(theme, tick, percent))
            }

            const line = justify(
              leftParts[0] + "  " + leftParts.slice(1).join(sep),
              rightParts.join(sep),
              width,
            )
            return [line]
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
    updateUsage(ctx)
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
