import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * Smart compaction: extracts key context from the conversation before
 * compaction discards it, and preserves it as a journal entry in memory.
 *
 * This ensures that file paths, decisions, and errors from long sessions
 * survive context compression. The journal entry is then available to
 * memory injection in subsequent runs.
 */

function extractContext(branchEntries: any[]): {
  touchedFiles: string[]
  errors: string[]
  decisions: string[]
} {
  const touchedFiles = new Set<string>()
  const errors: string[] = []
  const decisions: string[] = []

  for (const entry of branchEntries) {
    if (entry.type !== "message") continue
    const msg = entry.message
    if (!msg) continue

    // Extract file paths from tool calls
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown> | undefined
          const path = input?.path as string | undefined
          if (path) touchedFiles.add(path)
        }
      }
    }

    // Extract errors from tool results
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = block.text
          if (text.includes("Error") || text.includes("error") || text.includes("FAIL")) {
            const firstLine = text.split("\n")[0].slice(0, 200)
            if (firstLine.length > 10) errors.push(firstLine)
          }
        }
      }
    }
  }

  return {
    touchedFiles: [...touchedFiles].slice(0, 20),
    errors: errors.slice(0, 5),
    decisions,
  }
}

export default function smartCompactionExtension(pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event: any) => {
    const entries = event.branchEntries ?? []
    if (entries.length < 4) return // too small to bother

    const context = extractContext(entries)
    if (context.touchedFiles.length === 0) return

    const lines = [`Session compaction context:`]

    if (context.touchedFiles.length > 0) {
      lines.push(`Files touched: ${context.touchedFiles.join(", ")}`)
    }
    if (context.errors.length > 0) {
      lines.push(`Errors seen: ${context.errors.join("; ")}`)
    }

    const summary = lines.join("\n")

    // Save as a memory note (journal category)
    pi.events.emit("reckoner:memory-note", {
      category: "journal",
      note: summary,
      files: context.touchedFiles.slice(0, 5),
      tags: ["compaction"],
      confidence: "medium",
    })

    // Don't override the compaction — let pi handle it normally
    return undefined
  })
}
