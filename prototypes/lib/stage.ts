/**
 * Prototype stage.
 *
 * Every candidate footer animation is judged the same way: rendered live, in
 * all four reckoner themes at once, against one scripted session that contains
 * every moment an animation could care about — idle, a turn starting, tokens
 * streaming, a tool running, a step landing, verify going red, a compaction,
 * and back to idle.
 *
 * The scripted session is the point. An animation that looks lovely on a
 * still frame can still be wrong: it can move when nothing is happening, or
 * sit dead when everything is. Watching all four themes at once also catches
 * the case where a brightness ladder reads on amber but vanishes on navy.
 *
 * Animation state is derived, never accumulated: prototypes ask the sim how
 * long ago an event happened (`s.since("step_done")`) and compute their frame
 * from that. Pure functions of time, so rendering the same frame four times
 * (once per theme) can't advance anything four times.
 */

import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// Resolved from the entry script rather than import.meta so the prototypes
// run under both the ESM and CommonJS interpretations of this package.
const ENTRY = resolve(process.argv[1] ?? ".")
const THEME_DIR = join(dirname(ENTRY), "..", "themes")

// ── Palette ──────────────────────────────────────────────────────────────

export const THEME_NAMES = ["reckoner-exect", "reckoner-scope", "reckoner-wopr", "reckoner-darkspace"] as const

/**
 * The phosphor brightness ladder, dimmest first. `hot` and `peak` are the two
 * rungs above normal text — what a CRT cell looks like the instant it is
 * struck, before it decays back down.
 */
export type Role = "dim" | "muted" | "text" | "hot" | "peak" | "warning" | "error" | "success"

const ROLE_KEY: Record<Role, string> = {
  dim: "dim",
  muted: "muted",
  text: "text",
  hot: "accent",
  peak: "mdHeading",
  warning: "warning",
  error: "error",
  success: "success",
}

/** The ladder in order, for decay animations that walk down it. */
export const LADDER: Role[] = ["peak", "hot", "text", "muted", "dim"]

export interface Palette {
  name: string
  fg(role: Role, s: string): string
}

function loadPalette(name: string): Palette {
  const raw = JSON.parse(readFileSync(join(THEME_DIR, `${name}.json`), "utf8"))
  const vars: Record<string, string> = raw.vars ?? {}
  const hex: Partial<Record<Role, string>> = {}
  for (const [role, key] of Object.entries(ROLE_KEY) as Array<[Role, string]>) {
    const value = raw.colors[key]
    hex[role] = value?.startsWith("#") ? value : vars[value]
  }
  return {
    name: name.replace("reckoner-", ""),
    fg(role, s) {
      const h = hex[role] ?? "#888888"
      const r = parseInt(h.slice(1, 3), 16)
      const g = parseInt(h.slice(3, 5), 16)
      const b = parseInt(h.slice(5, 7), 16)
      return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`
    },
  }
}

export const PALETTES: Palette[] = THEME_NAMES.map(loadPalette)

// ── Layout ───────────────────────────────────────────────────────────────

const ANSI = /\x1b\[[0-9;]*m/g

export function visibleWidth(s: string): number {
  return s.replace(ANSI, "").length
}

/** Join left and right so the right side sits flush against the terminal edge. */
export function justify(left: string, right: string, width: number): string {
  const lw = visibleWidth(left)
  const rw = visibleWidth(right)
  if (lw + 2 + rw <= width) return left + " ".repeat(width - lw - rw) + right
  if (lw <= width) return left + " ".repeat(width - lw)
  return left
}

/**
 * Right-side degradation ladder. The narrower the terminal, the more of the
 * account side falls away — but in a chosen order, not all at once. The well
 * is last to go, because at 60 columns it is the one thing still worth knowing.
 */
export function fitRight(parts: string[], sep: string, budget: number): string {
  const kept = [...parts]
  while (kept.length > 1) {
    const line = kept.join(sep)
    if (visibleWidth(line) <= budget) return line
    kept.shift() // drop the least important (leftmost) first
  }
  return kept.join(sep)
}

/** One space inside a group, a raised ink fleck between groups. */
export const SEP = " ⠄ "

export function abbreviatePath(cwd: string): string {
  const segs = cwd.split("/")
  if (segs.length <= 3) return cwd
  const head = segs.slice(0, -1).map((s, i) => (i === 0 ? s : s.charAt(0)))
  return [...head, segs[segs.length - 1]].join("/")
}

/** Silkscreen: uppercase, dim — lettering printed on the chassis. */
export function label(p: Palette, text: string): string {
  return p.fg("dim", text)
}

// ── The scripted session ─────────────────────────────────────────────────

export type Phase = "idle" | "think" | "stream" | "tool" | "compact"

export interface SimState {
  t: number
  frame: number
  phase: Phase
  /** A token chunk landed on this frame — the raw pulse of the model talking. */
  chunk: boolean
  tool?: string
  contextPercent: number
  task: { done: number; total: number }
  cost: number
  issues: number
  caption: string
  /** Seconds since the last occurrence of an event, or Infinity if never. */
  since(event: string): number
}

const PERIOD = 26

interface Beat {
  at: number
  phase?: Phase
  tool?: string
  caption?: string
  events?: string[]
}

const SCRIPT: Beat[] = [
  { at: 0.0, phase: "idle", caption: "idle · nothing is running", events: ["idle"] },
  { at: 3.0, phase: "think", caption: "turn start · model is thinking", events: ["turn_start"] },
  { at: 4.2, phase: "stream", caption: "streaming · tokens arriving", events: ["first_token"] },
  { at: 8.0, phase: "tool", tool: "bash", caption: "tool running · bash", events: ["tool_start", "cost"] },
  { at: 10.5, phase: "stream", caption: "step 1 landed · streaming", events: ["tool_end", "step_done"] },
  { at: 13.0, phase: "stream", caption: "verify went red · 2 new issues", events: ["verify", "cost"] },
  { at: 15.5, phase: "tool", tool: "edit", caption: "tool running · edit", events: ["tool_start"] },
  { at: 17.0, phase: "stream", caption: "step 2 landed · streaming", events: ["tool_end", "step_done", "cost"] },
  { at: 19.5, phase: "compact", caption: "compacting · context is being reclaimed", events: ["compact_start"] },
  { at: 21.0, phase: "stream", caption: "compaction done · context reclaimed", events: ["compact_end", "cost"] },
  { at: 23.0, phase: "idle", caption: "turn end · back to idle", events: ["step_done", "turn_end", "cost"] },
]

const CONTEXT_CURVE: Array<[number, number]> = [
  [0, 34],
  [3, 34],
  [8, 52],
  [13, 68],
  [17, 79],
  [19.4, 91],
  [19.5, 91],
  [21, 38],
  [23, 46],
  [26, 46],
]

const COST_STEPS: Array<[number, number]> = [
  [0, 0.18],
  [8, 0.41],
  [13, 0.78],
  [17, 1.05],
  [21, 1.34],
  [23, 1.62],
]

function lerp(curve: Array<[number, number]>, t: number): number {
  for (let i = 1; i < curve.length; i++) {
    const [t0, v0] = curve[i - 1]
    const [t1, v1] = curve[i]
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-6, t1 - t0)
  }
  return curve[curve.length - 1][1]
}

/** Deterministic jitter so the token stream looks like a stream, not a metronome. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function simulate(frame: number, fps: number): SimState {
  const t = (frame / fps) % PERIOD
  const loop = Math.floor(frame / fps / PERIOD)

  let beat = SCRIPT[0]
  for (const b of SCRIPT) if (t >= b.at) beat = b

  const since = (event: string): number => {
    let best = Number.POSITIVE_INFINITY
    for (const b of SCRIPT) {
      if (!b.events?.includes(event)) continue
      if (b.at <= t) best = Math.min(best, t - b.at)
      else if (loop > 0) best = Math.min(best, t + PERIOD - b.at) // wrapped from last loop
    }
    return best
  }

  const stepsDone = SCRIPT.filter((b) => b.at <= t && b.events?.includes("step_done")).length
  const cost = COST_STEPS.filter(([at]) => at <= t).pop()?.[1] ?? 0.18

  // Tokens arrive in bursts; a stalled model shows up as a gap.
  const busy = beat.phase === "stream" || beat.phase === "think"
  const chunk = busy && hash(frame) > 0.45 && hash(Math.floor(frame / 7)) > 0.25

  return {
    t,
    frame,
    phase: beat.phase ?? "idle",
    chunk,
    tool: beat.tool,
    contextPercent: lerp(CONTEXT_CURVE, t),
    task: { done: stepsDone, total: 5 },
    cost,
    issues: since("verify") < Number.POSITIVE_INFINITY && t >= 13 && t < 23 ? 2 : 0,
    caption: beat.caption ?? "",
    since,
  }
}

// ── Runner ───────────────────────────────────────────────────────────────

export interface Stage {
  id: string
  title: string
  idea: string
  watch: string[]
  render(p: Palette, s: SimState, width: number): string
}

const FPS = 20

export function runStage(stage: Stage): void {
  const args = process.argv.slice(2)
  const framesArg = args.indexOf("--frames")
  const maxFrames = framesArg >= 0 ? Number(args[framesArg + 1]) : Number.POSITIVE_INFINITY
  const tty = process.stdout.isTTY === true
  const width = process.stdout.columns ?? 100

  const rule = "─".repeat(Math.min(width, 78))
  const out: string[] = []
  out.push("")
  out.push(`\x1b[1m${stage.id} · ${stage.title}\x1b[0m`)
  out.push(`\x1b[2m${rule}\x1b[0m`)
  out.push(`\x1b[2m${stage.idea}\x1b[0m`)
  out.push("")
  out.push("\x1b[2mwatch for:\x1b[0m")
  for (const w of stage.watch) out.push(`\x1b[2m  · ${w}\x1b[0m`)
  out.push("")
  out.push(`\x1b[2mthemes, top to bottom: ${PALETTES.map((p) => p.name).join(" · ")}\x1b[0m`)
  out.push("")
  process.stdout.write(out.join("\n") + "\n")

  const LIVE = PALETTES.length + 2
  let frame = 0

  const draw = () => {
    const s = simulate(frame, FPS)
    const lines = PALETTES.map((p) => stage.render(p, s, width))
    lines.push("")
    lines.push(`\x1b[2m  sim ▸ ${s.caption}\x1b[0m\x1b[K`)
    const body = lines.map((l) => `\x1b[2K${l}`).join("\n")
    process.stdout.write(body + "\n")
    if (tty) process.stdout.write(`\x1b[${LIVE}A`)
    frame++
    if (frame >= maxFrames) {
      stop()
      return
    }
  }

  const timer = setInterval(draw, 1000 / FPS)

  function stop() {
    clearInterval(timer)
    if (tty) process.stdout.write(`\x1b[${LIVE}B\x1b[?25h\n`)
    else process.stdout.write("\n")
    process.exit(0)
  }

  if (tty) process.stdout.write("\x1b[?25l")
  process.on("SIGINT", stop)
  draw()
}
