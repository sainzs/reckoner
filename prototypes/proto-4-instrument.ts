/**
 * Prototype 4 — instrument panel.
 *
 * The idea: the footer is a rack of gauges rather than a line of text, and it
 * animates the way physical instruments do — needles settle, digits roll,
 * sediment falls, a peak-hold marker drifts back down.
 *
 * Three animations, each attached to a number that actually moves:
 *   the roll      — cost digits tumble through two intermediate values when
 *                   they change, like a nixie or a split-flap, then hold
 *   the peak-hold — the well keeps a bright high-water marker at the fullest
 *                   the context has been, decaying back to the current level
 *                   over a few seconds, so you can see how fast it is filling
 *   the settling  — on compaction, ink visibly falls from surface to sediment
 *                   over a second, which is the only time this footer has ever
 *                   made compaction legible
 *
 * Cost: it is the loudest of the four, and the peak-hold marker is a second
 * moving thing inside a field that already has one. On a narrow terminal it is
 * the first thing that should be dropped.
 */

import { costText, inkLevel, inkRole, lead, model, place, session, TRAIL_CELLS, WELL_CELLS } from "./lib/parts.js"
import { fitRight, justify, type Palette, runStage, SEP, type SimState, visibleWidth } from "./lib/stage.js"

const ROLL_TIME = 0.36
const SETTLE_TIME = 1.1
const PEAK_DECAY = 4.0

/** Digits tumble through intermediates on change, in a fixed-width slot. */
function roll(p: Palette, s: SimState): string {
  const age = s.since("cost")
  const text = costText(s)
  if (age >= ROLL_TIME) return p.fg("dim", text)

  const step = Math.floor((age / ROLL_TIME) * 3)
  const scrambled = text
    .split("")
    .map((c) => (/\d/.test(c) ? String((Number(c) + 3 - step) % 10) : c))
    .join("")
  return p.fg(step === 0 ? "peak" : step === 1 ? "hot" : "text", scrambled)
}

/** Ink falling from surface to floor: the shape of a compaction. */
const FALLING = ["⣿", "⣶", "⣤", "⣀"]

function well(p: Palette, s: SimState): string {
  const { filled, remaining } = inkLevel(s)
  const rest = inkRole(remaining)

  // Peak hold: where the ink was at its lowest, drifting back to the truth.
  const held = Math.max(filled, filled + Math.round(2 * Math.max(0, 1 - s.since("compact_end") / PEAK_DECAY)))
  const settle = s.since("compact_start")
  const falling = settle < SETTLE_TIME ? FALLING[Math.min(FALLING.length - 1, Math.floor((settle / SETTLE_TIME) * 4))] : null

  let ink = ""
  for (let i = 0; i < WELL_CELLS; i++) {
    if (falling && i >= filled) ink += p.fg("dim", falling)
    else if (i < filled) ink += p.fg(rest, "⣿")
    else if (i === held - 1 && held > filled) ink += p.fg("hot", "⡇") // high-water marker
    else ink += p.fg("dim", "⣀")
  }
  return p.fg("dim", "CONTEXT ") + ink
}

/** Steps as a needle travelling a track, rather than a bar filling up. */
function needle(p: Palette, s: SimState): string {
  const { done, total } = s.task
  const age = s.since("step_done")
  const pos = Math.min(TRAIL_CELLS - 1, Math.round((done / total) * (TRAIL_CELLS - 1)))
  const overshoot = age < 0.18 && pos < TRAIL_CELLS - 1 ? 1 : 0 // needles overshoot, then settle

  let track = ""
  for (let i = 0; i < TRAIL_CELLS; i++) {
    if (i === pos + overshoot) track += p.fg(age < 0.6 ? "peak" : "text", "⣿")
    else if (i < pos) track += p.fg("muted", "⣤")
    else track += p.fg("dim", "⣀")
  }
  return p.fg("dim", "STEPS ") + track
}

runStage({
  id: "proto 4",
  title: "instrument panel — needles settle, digits roll, sediment falls",
  idea: "Gauges rather than text. Every animation is attached to a number that genuinely moved.",
  watch: [
    "at 19.5s compaction makes ink visibly fall — the one event the footer has never shown",
    "the cost digits tumble at 8s, 13s, 17s, 21s and 23s, in a fixed-width slot",
    "the bright high-water marker in the well drifts back after compaction",
    "the steps needle overshoots by one cell and settles, the way a real one does",
  ],
  render(p, s, width) {
    const lamp = s.phase === "idle" ? p.fg("dim", "⣀") : p.fg("text", "⣿")
    const left = [place(p), needle(p, s)]
    if (s.issues > 0) left.push(p.fg("warning", `${s.issues} new issues`))

    const leftLine = lead(lamp) + left.join(SEP)
    const right = [session(p), model(p), roll(p, s), well(p, s)]
    return justify(leftLine, fitRight(right, SEP, Math.max(0, width - visibleWidth(leftLine) - 4)), width)
  },
})
