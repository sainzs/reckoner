import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"

/**
 * Web tools: research and fetch online content.
 *
 * - web_fetch: retrieve any URL as clean markdown via Jina Reader (free, no key needed)
 * - web_search: search the web via Jina Search API (REQUIRES JINA_API_KEY)
 *
 * Without JINA_API_KEY, web_search falls back to web_fetch on known documentation
 * sites. All public search engines (Google, DDG, Brave) now serve CAPTCHAs to bots.
 *
 * Get a free API key at https://jina.ai/reader (1M tokens/month free tier)
 *
 * Environment variables:
 *   JINA_API_KEY — enables Jina Search and higher rate limits on fetch
 */

const FETCH_ENDPOINT = "https://r.jina.ai"
const SEARCH_ENDPOINT = "https://s.jina.ai"
const MAX_OUTPUT_BYTES = 40_000
const FETCH_TIMEOUT = 30_000

function truncate(text: string, maxBytes: number): { content: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { content: text, truncated: false }
  }

  const lines = text.split("\n")
  let size = 0
  let kept = 0
  for (const line of lines) {
    const lineSize = Buffer.byteLength(line + "\n", "utf8")
    if (size + lineSize > maxBytes) break
    size += lineSize
    kept++
  }

  const content = lines.slice(0, kept).join("\n")
  return {
    content: `${content}\n\n[Truncated: showing ${kept} of ${lines.length} lines]`,
    truncated: true,
  }
}

async function curlFetch(
  pi: ExtensionAPI,
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<{ body: string; status: number }> {
  const args = ["-s", "-w", "\n%{http_code}", "--max-time", "25", "-L"]
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`)
  }
  args.push(url)

  const result = await pi.exec("curl", args, { timeout: FETCH_TIMEOUT, signal })
  const output = (result.stdout ?? "").trim()
  const lines = output.split("\n")
  const statusLine = lines.pop() ?? "0"
  const body = lines.join("\n")
  const status = parseInt(statusLine, 10) || 0

  return { body, status }
}

function getJinaKey(): string | undefined {
  return process.env.JINA_API_KEY
}

async function jinaFetch(pi: ExtensionAPI, url: string, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { Accept: "text/markdown" }
  const key = getJinaKey()
  if (key) headers.Authorization = `Bearer ${key}`

  const { body, status } = await curlFetch(pi, `${FETCH_ENDPOINT}/${url}`, headers, signal)
  if (status >= 400) {
    throw new Error(`Jina Reader returned HTTP ${status} for ${url}`)
  }
  return body
}

async function jinaSearch(pi: ExtensionAPI, query: string, signal?: AbortSignal): Promise<string> {
  const key = getJinaKey()
  if (!key) throw new Error("no_jina_key")

  const encoded = encodeURIComponent(query)
  const { body, status } = await curlFetch(
    pi,
    `${SEARCH_ENDPOINT}/${encoded}`,
    { Accept: "text/markdown", Authorization: `Bearer ${key}` },
    signal,
  )
  if (status >= 400) {
    throw new Error(`Jina Search returned HTTP ${status}`)
  }
  return body
}

export default function webToolsExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      const hasKey = !!getJinaKey()
      ctx.ui.setStatus("web", hasKey ? "web: search + fetch" : "web: fetch only")
    }
  })

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and return its content as clean markdown. Uses Jina Reader to convert web pages to readable text. Good for documentation, articles, wiki pages, and any web content.",
    promptSnippet: "Fetch any URL as clean markdown for reading",
    promptGuidelines: [
      "Use web_fetch to read online documentation, wiki pages, articles, or any URL.",
      "Prefer web_fetch over bash curl for reading web content — it returns clean markdown.",
      "Some sites behind Cloudflare may return 403. Try alternative URLs if so.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Full URL to fetch (must start with http:// or https://)" }),
    }),

    async execute(_toolCallId, params, signal) {
      const url = params.url.trim()
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error(`Invalid URL: ${url} — must start with http:// or https://`)
      }

      const raw = await jinaFetch(pi, url, signal)
      const { content, truncated } = truncate(raw, MAX_OUTPUT_BYTES)

      return {
        content: [{ type: "text" as const, text: content }],
        details: { url, truncated, bytes: Buffer.byteLength(raw, "utf8") },
      }
    },
  })

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for information. Returns a list of results with titles, URLs, and snippets. Requires JINA_API_KEY environment variable (free at https://jina.ai/reader). If no API key is set, falls back to suggesting direct web_fetch on known documentation sites.",
    promptSnippet: "Search the web for documentation, solutions, or any information",
    promptGuidelines: [
      "Use web_search to find documentation, solutions, APIs, or any information online.",
      "After searching, use web_fetch to read the most relevant results in full.",
      "If web_search reports no API key, use web_fetch directly on known doc URLs instead.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),

    async execute(_toolCallId, params, signal) {
      const query = params.query.trim()

      try {
        const raw = await jinaSearch(pi, query, signal)
        const { content, truncated } = truncate(raw, MAX_OUTPUT_BYTES)
        return {
          content: [{ type: "text" as const, text: content }],
          details: { query, source: "jina", truncated },
        }
      } catch (err: any) {
        if (err.message === "no_jina_key") {
          const fallbackMsg = [
            `⚠ No JINA_API_KEY set — web search unavailable.`,
            ``,
            `To enable search: export JINA_API_KEY=<your-key>`,
            `Free tier (1M tokens/month): https://jina.ai/reader`,
            ``,
            `Workaround: use web_fetch directly on documentation sites:`,
            `  - MDN: https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}`,
            `  - npm: https://www.npmjs.com/search?q=${encodeURIComponent(query)}`,
            `  - GitHub: https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
            `  - Wikipedia: https://en.wikipedia.org/wiki/${encodeURIComponent(query.replace(/ /g, "_"))}`,
          ].join("\n")

          return {
            content: [{ type: "text" as const, text: fallbackMsg }],
            details: { query, source: "no_api_key", error: true },
          }
        }
        throw err
      }
    },
  })
}
