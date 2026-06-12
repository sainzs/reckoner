import test from "node:test"
import assert from "node:assert/strict"
import { scoreLessonRecord } from "../extensions/lib/memory-format.js"
import type { InjectionBuildContext, LessonRecord } from "../extensions/lib/lesson-types.js"

const context: InjectionBuildContext = {
  cwd: "/tmp/reckoner",
  budget: { total: 5000, remaining: 5000 },
  recentFiles: ["extensions/memory.ts"],
  activeTask: {
    title: "Improve memory relevance",
    done: 1,
    total: 3,
    nextStep: "Refine memory scoring",
    remainingSteps: ["Refine memory scoring", "Verify injection output"],
  },
}

const relevantRecord: LessonRecord = {
  id: "lesson-relevant",
  timestamp: "2026-03-30 12:00",
  category: "mistakes",
  source: "auto-verify",
  kind: "workflow",
  fingerprint: "memory-relevance",
  files: ["extensions/memory.ts"],
  tags: ["memory", "scoring"],
  confidence: "high",
  resolved: false,
  repeatCount: 3,
  summary: "Memory scoring regressions happen when relevance is ignored.",
  prevention: "Score lessons against touched files and active task text.",
}

const irrelevantRecord: LessonRecord = {
  id: "lesson-irrelevant",
  timestamp: "2026-02-01 12:00",
  category: "mistakes",
  source: "auto-verify",
  kind: "workflow",
  fingerprint: "theme-drift",
  files: ["themes/reckoner-dusk.json"],
  tags: ["theme"],
  confidence: "low",
  resolved: true,
  repeatCount: 1,
  summary: "Theme colors drifted in a different subsystem.",
}

test("scoreLessonRecord prefers file and task relevance", () => {
  const relevant = scoreLessonRecord(relevantRecord, context)
  const irrelevant = scoreLessonRecord(irrelevantRecord, context)

  assert.ok(relevant.score > irrelevant.score)
  assert.ok(relevant.reasons.some(reason => reason.includes("file overlap")))
  assert.ok(relevant.reasons.some(reason => reason.includes("task")))
})
