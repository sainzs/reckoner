import type { VerifyIssue } from "./lesson-types.js"

export function issueMap(issues: VerifyIssue[]): Map<string, VerifyIssue> {
  const map = new Map<string, VerifyIssue>()
  for (const issue of issues) {
    if (!map.has(issue.fingerprint)) {
      map.set(issue.fingerprint, issue)
    }
  }
  return map
}

export function diffIssueMaps(before: Map<string, VerifyIssue>, after: Map<string, VerifyIssue>) {
  const introduced: VerifyIssue[] = []
  const unchanged: VerifyIssue[] = []
  const resolved: VerifyIssue[] = []

  for (const [fingerprint, issue] of after.entries()) {
    if (before.has(fingerprint)) unchanged.push(issue)
    else introduced.push(issue)
  }

  for (const [fingerprint, issue] of before.entries()) {
    if (!after.has(fingerprint)) resolved.push(issue)
  }

  return { introduced, unchanged, resolved }
}
