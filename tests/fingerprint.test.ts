import test from "node:test"
import assert from "node:assert/strict"
import { fingerprintLesson, fingerprintTscIssue, normalizeDiagnosticMessage } from "../extensions/lib/fingerprint.js"

test("fingerprintTscIssue normalizes equivalent diagnostics", () => {
  const first = fingerprintTscIssue({
    code: "TS2345",
    file: "extensions/memory.ts",
    message: "Type 'Foo' is not assignable to type 'Bar' at line 12",
  })

  const second = fingerprintTscIssue({
    code: "TS2345",
    file: "./extensions/memory.ts",
    message: "Type `Baz` is not assignable to type `Qux` at line 999",
  })

  assert.equal(first, second)
})

test("normalizeDiagnosticMessage removes quoted values and numbers", () => {
  const normalized = normalizeDiagnosticMessage("Expected 'abc' to equal `def` at 42")
  assert.equal(normalized, 'expected "value" to equal "value" at #')
})

test("fingerprintLesson falls back to summary and source when explicit fingerprint is missing", () => {
  const fingerprint = fingerprintLesson({
    source: "auto-verify",
    kind: "type",
    files: ["extensions/auto-verify.ts"],
    summary: "Compiler regression after changing the verification pipeline",
  })

  assert.match(fingerprint, /^auto-verify\|type\|extensions\/auto-verify.ts\|/)
})
