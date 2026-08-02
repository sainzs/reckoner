/**
 * Prototype 1 — phosphor decay.
 *
 * The idea: nothing loops. Ever. The footer is a still object, and the only
 * motion is a cell being struck by an event and decaying back down the
 * brightness ladder — peak, hot, text, muted, dim — over about 700ms, the way
 * a phosphor dot fades after the beam passes.
 *
 * This is what the brightness ladder in the themes was actually built for.
 * Because it never loops, motion in the corner of your eye always means
 * something just happened, and a quiet session is a genuinely quiet screen:
 * zero renders while idle.
 *
 * Cost: you cannot tell "working" from "wedged" at a glance — both are still.
 * The liveness cell answers that by holding a colour rather than moving.
 */

import { costText, inkLevel, inkRole, lead, model, place, session, TRAIL_CELLS, WELL_CELLS } from "./lib/parts.js"
import { fitRight, justify, LADDER, type Palette, type Role, runStage, SEP, type SimState, visibleWidth } from "./lib/stage.js"

const DECAY = 0.7 // seconds from struck to settled

/** Walk down the ladder as an event ages; `rest` is where the cell settles. */
function decayed(age: number, rest: Role): Role {
  if (age >= DECAY) return rest
  const step = Math.floor((age / DECAY) * LADDER.length)
  const struck = LADDER[Math.min(step, LADDER.length - 1)]
  return LADDER.indexOf(struck) < LADDER.indexOf(rest) ? struck : rest
}

/**
 * Liveness by colour, not by movement: a single still cell that is dim when
 * idle, holds text while the model works, and flares on every tool return.
 */
function lamp(p: Palette, s: SimState): string {
  if (s.phase === "idle") return p.fg("dim", "⣀") // settled, not punctuation
  const role = decayed(Math.min(s.since("tool_end"), s.since("tool_start")), "text")
  return p.fg(role, "⣿")
}

/** The well, struck each time a cell's worth of context is consumed. */
function well(p: Palette, s: SimState): string {
  const { filled, remaining } = inkLevel(s)
  const rest = inkRole(remaining)
  const surfaceAge = s.since("compact_end")

  let ink = ""
  for (let i = 0; i < WELL_CELLS; i++) {
    if (i < filled - 1) ink += p.fg(rest, "⣿")
    else if (i === filled - 1) ink += p.fg(decayed(surfaceAge, rest), "⣶")
    else ink += p.fg("dim", "⣀")
  }
  return p.fg("dim", "CONTEXT ") + ink
}

/** The trail, where the newest step is still glowing from being laid down. */
function trail(p: Palette, s: SimState): string {
  const age = s.since("step_done")
  const { done, total } = s.task
  const doneCells = Math.round((done / total) * TRAIL_CELLS)

  let ink = ""
  for (let i = 0; i < TRAIL_CELLS; i++) {
    if (i < doneCells - 1) ink += p.fg("muted", "⣿")
    else if (i === doneCells - 1) ink += p.fg(decayed(age, "muted"), "⣿")
    else ink += p.fg("dim", "⣀")
  }
  return p.fg("dim", "STEPS ") + ink
}

runStage({
  id: "proto 1",
  title: "phosphor decay — nothing loops, events strike and fade",
  idea: "Still by default. Every animation is one-shot: struck to peak, decaying down the ladder to rest.",
  watch: [
    "the footer is completely still while idle — no breathing dot, no flicker",
    "at 10.5s and 17s a step lands and that one cell flares, then cools",
    "the lamp on the left holds colour while working instead of moving",
    "after compaction the well's surface flares once and settles",
  ],
  render(p, s, width) {
    const left = [place(p), trail(p, s)]
    if (s.issues > 0) left.push(p.fg(decayed(s.since("verify"), "warning"), `${s.issues} new issues`))

    const leftLine = lead(lamp(p, s)) + left.join(SEP)
    const right = [session(p), model(p), p.fg(decayed(s.since("cost"), "dim"), costText(s)), well(p, s)]
    return justify(leftLine, fitRight(right, SEP, Math.max(0, width - visibleWidth(leftLine) - 4)), width)
  },
})
