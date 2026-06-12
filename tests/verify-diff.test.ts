import test from "node:test"
import assert from "node:assert/strict"
import { diffIssueMaps, issueMap } from "../extensions/lib/verify-diff.js"
import type { VerifyIssue } from "../extensions/lib/lesson-types.js"

function issue(fingerprint: string, file: string): VerifyIssue {
  return {
    fingerprint,
    source: "tsc",
    severity: "error",
    file,
    message: fingerprint,
    raw: fingerprint,
    touchedRelated: true,
  }
}

test("diffIssueMaps separates introduced unchanged and resolved issues", () => {
  const before = issueMap([
    issue("same", "extensions/a.ts"),
    issue("gone", "extensions/b.ts"),
  ])
  const after = issueMap([
    issue("same", "extensions/a.ts"),
    issue("new", "extensions/c.ts"),
  ])

  const diff = diffIssueMaps(before, after)

  assert.deepEqual(diff.unchanged.map(entry => entry.fingerprint), ["same"])
  assert.deepEqual(diff.introduced.map(entry => entry.fingerprint), ["new"])
  assert.deepEqual(diff.resolved.map(entry => entry.fingerprint), ["gone"])
})
