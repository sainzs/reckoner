/**
 * Prototype 3 — paper tape.
 *
 * The idea: stop driving the animation from a clock and drive it from the
 * model. A three-cell field on the far left is a shift register: it advances
 * one frame for every chunk of tokens that arrives. Fast generation rips the
 * tape along; a stall freezes it mid-character; thinking with no output shows
 * as a slow, irregular crawl.
 *
 * This is the only prototype where the animation is telemetry rather than
 * decoration. You learn something real from it — you feel the model stall
 * before the text stops — and it costs nothing extra, because the render is
 * already happening when tokens land.
 *
 * While a tool runs there are no tokens, so the tape hands off to a drip: ink
 * beading and falling in one cell, on its own slow clock, because during a
 * tool call the honest signal is "waiting", not "producing".
 */

import { costText, inkLevel, inkRole, lead, model, place, session, TRAIL_CELLS, WELL_CELLS } from "./lib/parts.js"
import { fitRight, justify, type Palette, runStage, SEP, type SimState, simulate, visibleWidth } from "./lib/stage.js"

/** A shift register: dots march right out of the field as new ones enter. */
const TAPE = ["⡀", "⡄", "⡆", "⡇", "⣇", "⣧", "⣷", "⣿", "⣾", "⣼", "⣸", "⢸", "⠸", "⠘", "⠈", " "]

/** Ink beading and falling — the shape of waiting, not of producing. */
const DRIP = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"]

/**
 * Chunks are counted, not timed. In the real footer this is a counter bumped
 * in the message_update handler; here it is accumulated once per frame and
 * memoised, so rendering the same frame in four themes counts it once.
 */
const counted: number[] = [0]

function chunkCount(s: SimState): number {
  for (let f = counted.length; f <= s.frame; f++) {
    counted[f] = counted[f - 1] + (simulate(f, 20).chunk ? 1 : 0)
  }
  return counted[s.frame]
}

function tape(p: Palette, s: SimState): string {
  if (s.phase === "idle") return p.fg("dim", "⣀") + "  "
  if (s.phase === "tool" || s.phase === "compact") {
    const i = Math.floor(s.t * 6) % DRIP.length
    return p.fg("muted", DRIP[i]) + "  "
  }
  const n = chunkCount(s)
  let field = ""
  for (let cell = 0; cell < 3; cell++) {
    field += p.fg(cell === 0 ? "text" : cell === 1 ? "muted" : "dim", TAPE[(n + cell * 5) % TAPE.length])
  }
  return field
}

/**
 * The surface wobbles only while chunks are landing — the same gate as the
 * tape, so the whole footer breathes with the model instead of with a timer.
 */
const SURFACE = ["⣶", "⣷", "⣶", "⣾"]

function well(p: Palette, s: SimState): string {
  const { filled, remaining } = inkLevel(s)
  const rest = inkRole(remaining)
  const alive = s.phase === "stream" && rest === "muted"
  const surface = alive ? SURFACE[chunkCount(s) % SURFACE.length] : "⣶"

  let ink = ""
  for (let i = 0; i < WELL_CELLS; i++) {
    if (i < filled - 1) ink += p.fg(rest, "⣿")
    else if (i === filled - 1) ink += p.fg(rest, surface)
    else ink += p.fg("dim", "⣀")
  }
  return p.fg("dim", "CONTEXT ") + ink
}

function trail(p: Palette, s: SimState): string {
  const { done, total } = s.task
  const doneCells = Math.round((done / total) * TRAIL_CELLS)
  let ink = ""
  for (let i = 0; i < TRAIL_CELLS; i++) {
    ink += i < doneCells ? p.fg("muted", "⣿") : p.fg("dim", "⣀")
  }
  return p.fg("dim", "STEPS ") + ink
}

runStage({
  id: "proto 3",
  title: "paper tape — the animation is the token stream",
  idea: "The left field advances one frame per token chunk. Motion speed is generation speed, not a timer.",
  watch: [
    "the tape is irregular, in bursts — that is what the stream actually looks like",
    "at 8s and 15.5s tokens stop and the tape hands off to a slow drip: waiting, not producing",
    "the well's surface wobbles on the same gate, so nothing moves while idle",
    "ask yourself whether the irregularity reads as alive or as broken",
  ],
  render(p, s, width) {
    const left = [place(p), trail(p, s)]
    if (s.issues > 0) left.push(p.fg("warning", `${s.issues} new issues`))

    const leftLine = lead(tape(p, s)) + left.join(SEP)
    const right = [session(p), model(p), p.fg("dim", costText(s)), well(p, s)]
    return justify(leftLine, fitRight(right, SEP, Math.max(0, width - visibleWidth(leftLine) - 4)), width)
  },
})
