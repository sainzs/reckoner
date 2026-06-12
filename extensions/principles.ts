import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { InjectionBuildContext } from "./lib/lesson-types.js"

/**
 * Principles: injects behavioral guidelines before every agent run.
 *
 * These aren't restrictions — they're a philosophy. The difference between
 * an agent that ships working code and one that ships confident-sounding
 * broken code is almost entirely here.
 */

const PRINCIPLES = `
---
## Reckoner principles

**Read before acting.** Read files before editing. Understand systems before changing them.

**Smallest safe change.** Touch as little as possible. One function, not the module.

**Verify before done.** Run tests, check types, look at the diff. "Done" means confirmed.

**Acknowledge uncertainty.** If you're guessing, say so. Confident wrongness is worst.

**Use memory.** remember() learnings at session end. recall() before repeating past work.

**Research first.** web_fetch/web_search before guessing APIs. Look it up.

**Honor conventions.** Read AGENTS.md, README.md, existing style before writing.

## Tools

- **read/edit/write** — file ops. Read before edit. Edit with minimal oldText. Write for new files only.
- **bash** — shell, tests, builds, git, grep, find, anything else.
- **repo_map** — orient in unfamiliar code before diving into files.
- **sg_search** — structural code search (and rewrite preview) by AST pattern, not text.
- **web_fetch/web_search** — docs and research. Don't guess APIs.
- **remember/recall** — persist learnings across sessions. Be specific.
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
