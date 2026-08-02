/**
 * Prototype 5 — the shipped vocabulary, on a bench.
 *
 * This renders the exact functions the live footer uses (extensions/lib/
 * footer-ink.ts), so what you see here is what /reload will give you. It exists
 * because the real thing only shows you `fetching` when the agent happens to
 * hit the network, and you should not have to provoke your own harness to see
 * whether an animation works.
 *
 * Two views:
 *   default    every activity side by side, all four themes — the contact sheet
 *   --session  one scripted session, so you can watch the handoffs between
 *              activities, which is where a vocabulary usually falls apart
 */

import {
  type ActivityKind,
  type Cell,
  fieldCells,
  trailCells,
  VERB_WIDTH,
  verbFor,
  wellCells,
} from "../extensions/lib/footer-ink.js"
import { fitRight, justify, PALETTES, type Palette, SEP, visibleWidth } from "./lib/stage.js"

const ORDER: ActivityKind[] = [
  "idle",
  "thinking",
  "answering",
  "reading",
  "searching",
  "fetching",
  "editing",
  "running",
  "recalling",
  "settling",
]

const NOTES: Record<ActivityKind, string> = {
  idle: "still — the loop is torn down, zero renders",
  thinking: "a bead pools in the centre, swells, disperses",
  answering: "shift register, one frame per token chunk",
  reading: "a mid-height dot crosses, then carriage-returns",
  searching: "a full-height beam sweeps, never resting",
  fetching: "out to the wire, silence, then a reply returns",
  editing: "the stylus lays ink down, then flushes",
  running: "pistons reciprocating — a machine, not a fluid",
  recalling: "ink rising from below, all cells in unison",
  settling: "ink falling to the floor — a compaction",
}

const FPS = 12.5
const FRAME_MS = 80

function paint(p: Palette, cells: Cell[]): string {
  return cells.map((c) => p.fg(c.ink as any, c.glyph)).join("")
}

function lead(p: Palette, kind: ActivityKind, tick: number, chunks: number): string {
  return `${paint(p, fieldCells(kind, tick, chunks))} ${p.fg("dim", verbFor(kind).padEnd(VERB_WIDTH))}`
}

// ── Contact sheet: every activity at once ────────────────────────────────

function contactSheet(): void {
  const tty = process.stdout.isTTY === true
  const args = process.argv.slice(2)
  const framesArg = args.indexOf("--frames")
  const maxFrames = framesArg >= 0 ? Number(args[framesArg + 1]) : Number.POSITIVE_INFINITY

  process.stdout.write(
    [
      "",
      "\x1b[1mproto 5 · the shipped vocabulary\x1b[0m",
      `\x1b[2m${"─".repeat(72)}\x1b[0m`,
      "\x1b[2mThe same functions the live footer calls. One row per activity;",
      " within a row, the four themes: exect · scope · wopr · darkspace.\x1b[0m",
      "\x1b[2mRun with --session to watch the handoffs instead.\x1b[0m",
      "",
    ].join("\n") + "\n",
  )

  let frame = 0
  const LIVE = ORDER.length + 1

  const draw = () => {
    // Tokens arrive in bursts, so the tape looks like a stream and not a clock.
    const chunks = Math.floor(frame / 1.7) + (Math.floor(frame / 9) % 3)
    const lines = ORDER.map((kind) => {
      const fields = PALETTES.map((p) => paint(p, fieldCells(kind, frame, chunks))).join("  ")
      const verb = verbFor(kind) || "idle"
      return `\x1b[2K  ${fields}   \x1b[2m${verb.padEnd(10)}${NOTES[kind]}\x1b[0m`
    })
    lines.push("\x1b[2K")
    process.stdout.write(lines.join("\n") + "\n")
    if (tty) process.stdout.write(`\x1b[${LIVE}A`)
    frame++
    if (frame >= maxFrames) finish(LIVE, tty)
  }

  loop(draw, LIVE, tty)
}

// ── Session view: the handoffs ───────────────────────────────────────────

interface Beat {
  at: number
  kind: ActivityKind
  caption: string
}

const SESSION: Beat[] = [
  { at: 0, kind: "idle", caption: "idle · the loop is stopped, nothing renders" },
  { at: 2, kind: "thinking", caption: "turn_start · provider composing, no deltas yet" },
  { at: 5, kind: "answering", caption: "text_delta · the tape moves at the model's pace" },
  { at: 8, kind: "searching", caption: "tool_execution_start · grep" },
  { at: 10.5, kind: "reading", caption: "tool_execution_start · read" },
  { at: 13, kind: "fetching", caption: "tool_execution_start · web_search" },
  { at: 16, kind: "editing", caption: "tool_execution_start · edit" },
  { at: 18.5, kind: "running", caption: "tool_execution_start · bash" },
  { at: 21, kind: "recalling", caption: "tool_execution_start · recall" },
  { at: 23, kind: "answering", caption: "text_delta · streaming the result" },
  { at: 26, kind: "settling", caption: "session_before_compact · context reclaimed" },
  { at: 29, kind: "idle", caption: "turn_end · quiet for 1.5s, then the loop stops" },
]

const PERIOD = 32
const CONTEXT: Array<[number, number]> = [[0, 38], [8, 55], [16, 71], [26, 88], [28, 41], [32, 45]]

function lerp(curve: Array<[number, number]>, t: number): number {
  for (let i = 1; i < curve.length; i++) {
    const [t0, v0] = curve[i - 1]
    const [t1, v1] = curve[i]
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-6, t1 - t0)
  }
  return curve[curve.length - 1][1]
}

function sessionView(): void {
  const tty = process.stdout.isTTY === true
  const args = process.argv.slice(2)
  const framesArg = args.indexOf("--frames")
  const maxFrames = framesArg >= 0 ? Number(args[framesArg + 1]) : Number.POSITIVE_INFINITY
  const width = process.stdout.columns ?? 100

  process.stdout.write(
    [
      "",
      "\x1b[1mproto 5 · one session, all the handoffs\x1b[0m",
      `\x1b[2m${"─".repeat(72)}\x1b[0m`,
      "\x1b[2mthemes, top to bottom: " + PALETTES.map((p) => p.name).join(" · ") + "\x1b[0m",
      "",
    ].join("\n") + "\n",
  )

  let frame = 0
  const LIVE = PALETTES.length + 2

  const draw = () => {
    const t = (frame / FPS) % PERIOD
    let beat = SESSION[0]
    for (const b of SESSION) if (t >= b.at) beat = b
    const chunks = Math.floor(frame / 1.7)
    const percent = lerp(CONTEXT, t)
    const alive = beat.kind === "answering" || beat.kind === "thinking"

    const lines = PALETTES.map((p) => {
      const left = `  ${lead(p, beat.kind, frame, chunks)}  ` +
        p.fg("muted", "~/C/p/a/p/reckoner  main +3") +
        p.fg("dim", SEP) + p.fg("dim", "STEPS ") + paint(p, trailCells(2, 5))
      // Same ordered shedding as the live footer: the well is last to go.
      const right = [
        p.fg("muted", "footer-redesign"),
        p.fg("dim", "claude-opus-5"),
        p.fg("dim", " $1.62"),
        p.fg("dim", "CONTEXT ") + paint(p, wellCells(percent, chunks, alive)),
      ]
      const budget = Math.max(0, width - visibleWidth(left) - 4)
      return "\x1b[2K" + justify(left, fitRight(right, p.fg("dim", SEP), budget), width)
    })
    lines.push("\x1b[2K")
    lines.push(`\x1b[2K\x1b[2m  ${beat.caption}\x1b[0m`)
    process.stdout.write(lines.join("\n") + "\n")
    if (tty) process.stdout.write(`\x1b[${LIVE}A`)
    frame++
    if (frame >= maxFrames) finish(LIVE, tty)
  }

  loop(draw, LIVE, tty)
}

// ── Runner ───────────────────────────────────────────────────────────────

function finish(live: number, tty: boolean): never {
  if (tty) process.stdout.write(`\x1b[${live}B\x1b[?25h\n`)
  else process.stdout.write("\n")
  process.exit(0)
}

function loop(draw: () => void, live: number, tty: boolean): void {
  if (tty) process.stdout.write("\x1b[?25l")
  const timer = setInterval(draw, FRAME_MS)
  process.on("SIGINT", () => {
    clearInterval(timer)
    finish(live, tty)
  })
  draw()
}

if (process.argv.includes("--session")) sessionView()
else contactSheet()
