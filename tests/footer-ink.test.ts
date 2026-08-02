import assert from "node:assert/strict"
import { test } from "node:test"
import {
  type ActivityKind,
  activityForTool,
  FIELD_CELLS,
  fieldCells,
  trailCells,
  TRAIL_CELLS,
  VERB_WIDTH,
  verbFor,
  WELL_CELLS,
  wellCells,
} from "../extensions/lib/footer-ink.js"

const ALL: ActivityKind[] = [
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

test("every activity holds the field's reserved width at every frame", () => {
  for (const kind of ALL) {
    for (let tick = 0; tick < 120; tick++) {
      const cells = fieldCells(kind, tick, tick)
      assert.equal(cells.length, FIELD_CELLS, `${kind} at tick ${tick}`)
      for (const cell of cells) assert.equal([...cell.glyph].length, 1, `${kind} cell is one glyph`)
    }
  }
})

test("verbs fit the reserved slot so nothing downstream shifts", () => {
  for (const kind of ALL) {
    assert.ok(verbFor(kind).length <= VERB_WIDTH, `${kind} verb fits`)
  }
})

test("idle is genuinely still — the same frame forever", () => {
  const first = JSON.stringify(fieldCells("idle", 0, 0))
  for (const tick of [1, 7, 41, 999]) {
    assert.equal(JSON.stringify(fieldCells("idle", tick, tick * 3)), first)
  }
})

test("only the tape follows the token stream; the rest follow the clock", () => {
  const still = fieldCells("answering", 5, 10)
  assert.notDeepEqual(fieldCells("answering", 5, 11), still, "a chunk advances the tape")
  assert.deepEqual(fieldCells("running", 5, 11), fieldCells("running", 5, 999), "chunks do not drive running")
})

test("frames are pure, so a re-render cannot advance an animation", () => {
  for (const kind of ALL) {
    assert.deepEqual(fieldCells(kind, 9, 4), fieldCells(kind, 9, 4), kind)
  }
})

test("tools map to the work they actually do", () => {
  assert.equal(activityForTool("read"), "reading")
  assert.equal(activityForTool("ls"), "reading")
  assert.equal(activityForTool("grep"), "searching")
  assert.equal(activityForTool("sg_search"), "searching")
  assert.equal(activityForTool("repo_map"), "searching")
  assert.equal(activityForTool("edit"), "editing")
  assert.equal(activityForTool("write"), "editing")
  assert.equal(activityForTool("bash"), "running")
  assert.equal(activityForTool("recall"), "recalling")
  // The wire is not the checkout: web_search contains "search" and must not
  // be mistaken for grepping the working tree.
  assert.equal(activityForTool("web_search"), "fetching")
  assert.equal(activityForTool("web_fetch"), "fetching")
  // An unknown tool is honestly "something is executing".
  assert.equal(activityForTool("some_new_tool"), "running")
})

test("the well is fixed width and reports remaining ink, not spent", () => {
  for (const percent of [0, 12, 50, 71, 95, 100]) {
    const cells = wellCells(percent, 0, false)
    assert.equal(cells.length, WELL_CELLS, `${percent}% is ${WELL_CELLS} cells`)
  }
  const full = wellCells(0, 0, false)
  assert.ok(full.every((c) => c.ink === "muted"), "a fresh context is calm")
  const spent = wellCells(95, 0, false)
  assert.ok(spent.some((c) => c.ink === "error"), "a nearly full context holds error")
  const low = wellCells(75, 0, false)
  assert.ok(low.some((c) => c.ink === "warning"), "a filling context holds warning")
})

test("a low well stills — stillness is severity, nothing blinks", () => {
  const a = wellCells(95, 0, true)
  const b = wellCells(95, 7, true)
  assert.deepEqual(a, b, "the surface does not move when the ink is nearly gone")
})

test("the trail is fixed width so a task appearing never shifts the line", () => {
  for (const total of [1, 3, 5, 20]) {
    for (let done = 0; done <= total; done++) {
      assert.equal(trailCells(done, total).length, TRAIL_CELLS, `${done}/${total}`)
    }
  }
  assert.equal(trailCells(0, 0).length, TRAIL_CELLS, "a zero-length task does not divide by zero")
})
