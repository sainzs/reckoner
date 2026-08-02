/**
 * The ink vocabulary: one animation per kind of work.
 *
 * The footer's leftmost field is three cells wide and never changes width. What
 * moves in those three cells says what the harness is doing right now, and each
 * motion is shaped like the work it stands for:
 *
 *   thinking   a bead pools in the centre, swells, disperses — considering
 *   answering  a shift register advancing one frame per token chunk — the tape
 *   reading    a mid-height dot runs left to right, then carriage-returns
 *   searching  a full-height beam sweeps back and forth, never resting
 *   fetching   a dot leaves for the wire, the wire is silent, a reply returns
 *   editing    ink is laid down cell by cell, then flushed — the stylus
 *   running    pistons reciprocate on a mechanical beat — the machine turns
 *   recalling  ink rises from below in unison — something surfacing
 *   settling   ink falls from surface to floor in a cascade — compaction
 *   idle       one dim bead of settled ink, perfectly still
 *
 * Two rules hold the set together. First, the tape is the only animation driven
 * by a counter rather than a clock: it advances when tokens actually arrive, so
 * its speed is the model's speed and a stall is visible as a freeze. Everything
 * else is a function of elapsed time within its own activity. Second, idle is
 * genuinely still — not a slow loop — because motion that never stops is motion
 * that stops meaning anything.
 *
 * Every function here is pure: a frame is a function of (activity, tick,
 * chunks). Nothing accumulates, so a re-render can never advance an animation
 * and a reinstalled footer can never reset one.
 */

/** The rungs of the phosphor ladder that the ink uses, dimmest first. */
export type Ink = "dim" | "muted" | "text" | "accent" | "mdHeading" | "warning" | "error"

export type ActivityKind =
  | "idle"
  | "thinking"
  | "answering"
  | "reading"
  | "searching"
  | "fetching"
  | "editing"
  | "running"
  | "recalling"
  | "settling"

/** A rendered cell: what to draw and how bright. */
export interface Cell {
  glyph: string
  ink: Ink
}

export const FIELD_CELLS = 3
/** Widest verb, so the slot can be reserved and nothing downstream ever shifts. */
export const VERB_WIDTH = 9

const VERBS: Record<ActivityKind, string> = {
  // Idle names itself rather than leaving the reserved slot blank: the slot has
  // to be held open anyway, and a labelled gap reads better than an empty one.
  idle: "idle",
  thinking: "thinking",
  answering: "answering",
  reading: "reading",
  searching: "searching",
  fetching: "fetching",
  editing: "editing",
  running: "running",
  recalling: "recalling",
  settling: "settling",
}

export function verbFor(kind: ActivityKind): string {
  return VERBS[kind]
}

/**
 * Which work a tool is. Unknown tools fall back to `running`, which is the
 * honest answer for a tool the footer has never heard of: something is
 * executing and we do not know what shape it has.
 */
export function activityForTool(toolName: string): ActivityKind {
  const t = toolName.toLowerCase()
  // The wire first: `web_search` contains "search", and going out to the
  // network is a different kind of waiting than grepping a checkout.
  if (t.startsWith("web") || t.includes("fetch") || t.includes("browse") || t.includes("http")) return "fetching"
  if (t === "read" || t === "ls" || t === "list" || t === "tree") return "reading"
  if (t === "grep" || t === "find" || t === "glob" || t === "repo_map" || t.includes("search")) return "searching"
  if (t === "edit" || t === "write" || t.includes("patch") || t.includes("apply")) return "editing"
  if (t === "recall" || t === "remember" || t.includes("memory")) return "recalling"
  return "running"
}

// ── Frame tables ─────────────────────────────────────────────────────────
//
// Each table is a list of three-glyph frames. A blank cell is a space, not a
// braille blank, so the field measures the same in every terminal.

/** thinking: a bead pools in the centre, swells, and disperses to the sides. */
const THINKING = [" ⡀ ", " ⣀ ", " ⣤ ", "⡀⣶⢀", "⣀⣿⣀", "⣄⣿⣠", "⣤⣶⣤", "⣀⣀⣀", "⠄ ⠄", "   "]

/** answering: a shift register. Dots march right and out of the field. */
const TAPE = ["⡀", "⡄", "⡆", "⡇", "⣇", "⣧", "⣷", "⣿", "⣾", "⣼", "⣸", "⢸", "⠸", "⠘", "⠈", " "]

/** reading: a mid-height dot crosses the line, then flies back. */
const READING = ["⠐  ", " ⠒ ", "  ⠰", "   "]

/** searching: a full-height beam, sweeping, never resting. */
const SEARCHING = ["⣿⣤ ", "⣤⣿⣤", " ⣤⣿", "⣤⣿⣤"]

/** fetching: outbound dots hug the left, the reply hugs the right. */
const FETCHING = ["⡀  ", " ⡀ ", "  ⡀", "   ", "   ", "  ⢀", " ⢀ ", "⢀  ", "   "]

/** editing: the stylus lays ink down, then the line is flushed. */
const EDITING = ["⡀  ", "⣄  ", "⣿⡀ ", "⣿⣄ ", "⣿⣿⡀", "⣿⣿⣄", "⣿⣿⣿", "⣤⣤⣤", "⣀⣀⣀", "   "]

/** running: pistons reciprocating. A machine, not a fluid. */
const RUNNING = ["⣿⣀⣿", "⣶⣤⣶", "⣀⣿⣀", "⣤⣶⣤"]

/** recalling: ink rising from below, all cells in unison. */
const RECALLING = ["⣀⣀⣀", "⣤⣤⣤", "⣶⣶⣶", "⣿⣿⣿", "⣶⣶⣶", "⣤⣤⣤", "   ", "   "]

/** settling: ink falling from surface to floor, staggered — a compaction. */
const SETTLING = ["⣿⣿⣿", "⣶⣿⣿", "⣤⣶⣿", "⣀⣤⣶", " ⣀⣤", "  ⣀", "   "]

/** How many ticks each frame is held. Bigger is slower and calmer. */
const TEMPO: Record<Exclude<ActivityKind, "idle" | "answering">, number> = {
  thinking: 3,
  reading: 2,
  searching: 2,
  fetching: 2,
  editing: 2,
  running: 3,
  recalling: 3,
  settling: 3,
}

/** Brightness for the field, per activity. Work in flight reads as `text`. */
const FIELD_INK: Record<ActivityKind, Ink> = {
  idle: "dim",
  thinking: "muted",
  answering: "text",
  reading: "text",
  searching: "text",
  fetching: "text",
  editing: "text",
  running: "text",
  recalling: "muted",
  settling: "warning",
}

const TABLES: Record<Exclude<ActivityKind, "idle" | "answering">, string[]> = {
  thinking: THINKING,
  reading: READING,
  searching: SEARCHING,
  fetching: FETCHING,
  editing: EDITING,
  running: RUNNING,
  recalling: RECALLING,
  settling: SETTLING,
}

/**
 * The three-cell field for the current activity.
 *
 * `tick` is the render clock; `chunks` is the number of token chunks that have
 * landed this session. Only `answering` reads `chunks` — that is what makes the
 * tape move at the model's pace instead of the timer's.
 */
export function fieldCells(kind: ActivityKind, tick: number, chunks: number): Cell[] {
  if (kind === "idle") {
    return [{ glyph: "⣀", ink: "dim" }, { glyph: " ", ink: "dim" }, { glyph: " ", ink: "dim" }]
  }

  if (kind === "answering") {
    // Head at the left, fading down the ladder as dots travel right and leave.
    const ladder: Ink[] = ["text", "muted", "dim"]
    return [0, 1, 2].map((cell) => ({
      glyph: TAPE[(chunks + cell * 5) % TAPE.length],
      ink: ladder[cell],
    }))
  }

  const table = TABLES[kind]
  const frame = table[Math.floor(tick / TEMPO[kind]) % table.length]
  const ink = FIELD_INK[kind]
  return [...frame].slice(0, FIELD_CELLS).map((glyph) => ({ glyph, ink }))
}

// ── The well ─────────────────────────────────────────────────────────────

export const WELL_CELLS = 6

/**
 * Remaining context as ink. Solid where full, a surface cell that wobbles only
 * while tokens are landing, sediment where spent.
 *
 * Stillness is severity: below 30% left the well holds warning and stops
 * moving, below 10% it holds error. Nothing here ever blinks.
 */
const SURFACE = ["⣶", "⣷", "⣶", "⣾"]

export function wellCells(percentUsed: number, chunks: number, alive: boolean): Cell[] {
  const remaining = Math.max(0, 100 - percentUsed)
  const filled = Math.max(remaining > 0 ? 1 : 0, Math.round((remaining / 100) * WELL_CELLS))
  const ink: Ink = remaining < 10 ? "error" : remaining < 30 ? "warning" : "muted"
  const calm = ink === "muted"
  const surface = alive && calm ? SURFACE[chunks % SURFACE.length] : "⣶"

  const cells: Cell[] = []
  for (let i = 0; i < WELL_CELLS; i++) {
    if (i < filled - 1) cells.push({ glyph: "⣿", ink })
    else if (i === filled - 1) cells.push({ glyph: surface, ink })
    else cells.push({ glyph: "⣀", ink: "dim" })
  }
  return cells
}

// ── The trail ────────────────────────────────────────────────────────────

export const TRAIL_CELLS = 8

/**
 * Task progress as ink laid down. Fixed width with dry track ahead, so a task
 * appearing or growing never drags the rest of the line sideways.
 */
export function trailCells(done: number, total: number): Cell[] {
  const doneCells = total > 0 ? Math.round((done / total) * TRAIL_CELLS) : 0
  const cells: Cell[] = []
  for (let i = 0; i < TRAIL_CELLS; i++) {
    cells.push(i < doneCells ? { glyph: "⣿", ink: "muted" } : { glyph: "⣀", ink: "dim" })
  }
  return cells
}
