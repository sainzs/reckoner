/**
 * Prototype 2 — raster sweep and teletype.
 *
 * The idea: the footer behaves like a CRT being refreshed. A single bright
 * cell sweeps left to right across the ink whenever the machine takes a pass —
 * once per turn, once per tool call — and words that appear are typed in one
 * character per frame rather than popping into existence.
 *
 * The sweep is the working indicator: it repeats slowly while the model is
 * working and stops entirely when it isn't, so the rhythm of the sweep tells
 * you the machine is still turning over without anything jittering in place.
 *
 * Cost: a travelling highlight is the most attention-grabbing thing here.
 * It is deliberately slow (about 600ms end to end) and it never repeats faster
 * than every three seconds, or it becomes a barber pole.
 */

import { costText, inkLevel, inkRole, lead, model, place, session, TRAIL_CELLS, WELL_CELLS } from "./lib/parts.js"
import { fitRight, justify, type Palette, runStage, SEP, type SimState, visibleWidth } from "./lib/stage.js"

const SWEEP_PERIOD = 3.0 // seconds between passes while working
const SWEEP_TIME = 0.6 // seconds for one pass across a field

/**
 * Where the beam is right now, as a fraction across the field, or null when
 * the machine is idle and the screen is simply holding its image.
 */
function beam(s: SimState): number | null {
  if (s.phase === "idle") return null
  const sinceTurn = s.since("turn_start")
  if (!Number.isFinite(sinceTurn)) return null
  const phase = sinceTurn % SWEEP_PERIOD
  return phase < SWEEP_TIME ? phase / SWEEP_TIME : null
}

/** Struck cells sit two rungs above their neighbours; the rest is unchanged. */
function sweepRole(pos: number | null, i: number, cells: number, rest: "muted" | "warning" | "error" | "dim") {
  if (pos === null) return rest
  const head = Math.floor(pos * cells)
  if (i === head) return "peak" as const
  if (i === head - 1) return "hot" as const
  return rest
}

function well(p: Palette, s: SimState): string {
  const { filled, remaining } = inkLevel(s)
  const rest = inkRole(remaining)
  const pos = beam(s)

  let ink = ""
  for (let i = 0; i < WELL_CELLS; i++) {
    const lit = i < filled
    ink += p.fg(lit ? sweepRole(pos, i, WELL_CELLS, rest) : sweepRole(pos, i, WELL_CELLS, "dim"), lit ? "⣿" : "⣀")
  }
  return p.fg("dim", "CONTEXT ") + ink
}

function trail(p: Palette, s: SimState): string {
  const { done, total } = s.task
  const doneCells = Math.round((done / total) * TRAIL_CELLS)
  const pos = beam(s)

  let ink = ""
  for (let i = 0; i < TRAIL_CELLS; i++) {
    const lit = i < doneCells
    ink += p.fg(lit ? sweepRole(pos, i, TRAIL_CELLS, "muted") : sweepRole(pos, i, TRAIL_CELLS, "dim"), lit ? "⣿" : "⣀")
  }
  return p.fg("dim", "STEPS ") + ink
}

/**
 * Teletype: the word arrives one character at a time, then is still forever.
 * The eye is pulled to it exactly once, at the moment the thing became true.
 */
function typed(text: string, age: number, cps = 40): string {
  const shown = Math.min(text.length, Math.floor(age * cps))
  return text.slice(0, shown).padEnd(text.length)
}

runStage({
  id: "proto 2",
  title: "raster sweep — the machine takes a pass",
  idea: "A bright cell sweeps the ink once per pass while working, and stops dead when idle. Words type in.",
  watch: [
    "the sweep starts at 3s and repeats every 3s, then stops at 23s",
    "at 13s the issue count types itself in rather than appearing",
    "the well and trail are otherwise perfectly static",
    "on the navy theme, check the sweep is still legible against text",
  ],
  render(p, s, width) {
    const lamp = s.phase === "idle" ? p.fg("dim", "⣀") : p.fg("text", "⣿")
    const left = [place(p), trail(p, s)]
    if (s.issues > 0) left.push(p.fg("warning", typed(`${s.issues} new issues`, s.since("verify"))))

    const leftLine = lead(lamp) + left.join(SEP)
    const right = [session(p), model(p), p.fg("dim", costText(s)), well(p, s)]
    return justify(leftLine, fitRight(right, SEP, Math.max(0, width - visibleWidth(leftLine) - 4)), width)
  },
})
