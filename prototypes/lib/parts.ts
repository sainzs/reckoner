/**
 * The parts of the footer that are not up for debate, shared by every
 * prototype so the only visible difference between them is the animation.
 *
 * Fixed-width slots throughout: a field that changes width while it animates
 * drags the whole line with it, and that reflow is what reads as jank. Cost is
 * padded, the well is always WELL_CELLS wide, the trail is always TRAIL_CELLS
 * wide with dry track ahead.
 */

import { abbreviatePath, type Palette, type SimState } from "./stage.js"

export const WELL_CELLS = 6
export const TRAIL_CELLS = 8

const CWD = "/Users/sainzs/Code/projects/agent-workbench/packages/reckoner"
const BRANCH = "main"
const DIRTY = 3
const SESSION = "footer-redesign"
const MODEL = "claude-opus-5"

/** Where am I — path and branch, always present, always quiet. */
export function place(p: Palette): string {
  const path = abbreviatePath(CWD.replace("/Users/sainzs", "~"))
  return p.fg("muted", `${path}  ${BRANCH} +${DIRTY}`)
}

/**
 * The liveness cell sits alone at the far left, separated by plain space, not
 * by the group fleck — an idle lamp and a separator must never be the same
 * glyph in the same row, or the eye reads the lamp as punctuation.
 */
export function lead(cell: string): string {
  return `  ${cell}  `
}

export function session(p: Palette): string {
  return p.fg("muted", SESSION)
}

export function model(p: Palette): string {
  return p.fg("dim", MODEL)
}

/** Fixed six columns so a rolling digit never shifts its neighbours. */
export function costText(s: SimState): string {
  return `$${s.cost.toFixed(2)}`.padStart(6)
}

/** How much ink is left, in cells. Always returns at least one lit cell. */
export function inkLevel(s: SimState): { filled: number; remaining: number } {
  const remaining = Math.max(0, 100 - s.contextPercent)
  const filled = Math.max(remaining > 0 ? 1 : 0, Math.round((remaining / 100) * WELL_CELLS))
  return { filled, remaining }
}

/** Stillness as severity: the well holds a warning colour rather than blinking. */
export function inkRole(remaining: number): "muted" | "warning" | "error" {
  return remaining < 10 ? "error" : remaining < 30 ? "warning" : "muted"
}
