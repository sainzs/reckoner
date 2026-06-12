import test from "node:test"
import assert from "node:assert/strict"
import { parseLessonFile, serializeLessonRecord } from "../extensions/lib/memory-format.js"
import type { LessonRecord } from "../extensions/lib/lesson-types.js"

const record: LessonRecord = {
  id: "lesson-1",
  timestamp: "2026-03-30 15:42",
  category: "mistakes",
  source: "auto-verify",
  kind: "type",
  fingerprint: "tsc|TS2345|extensions/inject.ts|builder-signature",
  files: ["extensions/inject.ts"],
  tags: ["typescript", "injection"],
  confidence: "high",
  resolved: false,
  repeatCount: 3,
  summary: "Changing the injection builder signature broke emitters.",
  trigger: "Edited inject.ts",
  symptom: "TS2345 in memory.ts",
  rootCause: "Contract changed without updating emitters.",
  prevention: "Centralize the injection contract.",
  outcome: "unresolved",
}

test("serializeLessonRecord round-trips through parseLessonFile", () => {
  const serialized = serializeLessonRecord(record)
  const parsed = parseLessonFile(serialized, "mistakes")

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].summary, record.summary)
  assert.equal(parsed[0].prevention, record.prevention)
  assert.equal(parsed[0].repeatCount, 3)
  assert.equal(parsed[0].fingerprint, record.fingerprint)
})

test("parseLessonFile can read legacy unstructured entries", () => {
  const legacy = `## 2026-03-29 01:00\nA vague old note about nvim state drift.\n`
  const parsed = parseLessonFile(legacy, "mistakes")

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].summary, "A vague old note about nvim state drift.")
  assert.equal(parsed[0].category, "mistakes")
  assert.ok(parsed[0].fingerprint)
})
