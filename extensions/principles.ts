import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { InjectionBuildContext } from "./lib/lesson-types.js"

const PRINCIPLES = `
---
## Reckoner principles

Read before editing. Understand before changing. Smallest safe change.
Verify before done — run tests, check types, read the diff.
If guessing, say so. remember() at session end. recall() before repeating past work.
web_fetch/web_search before guessing APIs. Honor existing conventions.
Keep command output concise (pipe through head/tail/rg). Never repeat a slow command — narrow scope or switch approach.
---
`.trim()

export default function principlesExtension(pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    pi.events.emit("reckoner:register-injection", {
      key: "principles",
      priority: 10,
      maxChars: 1200,
      build: (_context: InjectionBuildContext) => ({
        key: "principles",
        text: `\n\n${PRINCIPLES}`,
        chars: PRINCIPLES.length + 2,
        reason: "base operating principles",
        priority: 10,
      }),
    })
  })
}
