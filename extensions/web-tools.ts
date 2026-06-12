import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"

/**
 * Web tools: research and fetch online content.
 *
 * - web_fetch: retrieve any URL as clean markdown via Jina Reader
 * - web_search: search the web via Jina Search API (needs JINA_API_KEY)
 *   or fall back to DuckDuckGo HTML scraping
 *
 * Environment variables:
 *   JINA_API_KEY  — optional, enables Jina Search and higher rate limits on fetch
 */

const FETCH_ENDPOINT = "https://r.jina.ai"
const SEARCH_ENDPOINT = "https://s.jina.ai"
const DDG_ENDPOINT = "https://html.duckduckgo.com/html"
const MAX_OUTPUT_BYTES = 40_000
const FETCH_TIMEOUT = 30_000

function truncate(text: string, maxBytes: number): { content: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { content: text, truncated: false }
  }

  // Truncate by lines to avoid cutting mid-character
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
  const totalLines = lines.length
  return {
    content: `${content}\n\n[Truncated: showing ${kept} of ${totalLines} lines]`,
    truncated: true,
  }
}

async function curlFetch(
  pi: ExtensionAPI,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ body: string; status: number }> {
  const args = ["-s", "-w", "\n%{http_code}", "--max-time", "25", "-L"]
  for (const [key, value] of Object.entries(headers)) {
    args.push("-H", `${key}: ${value}`)
  }
  args.push(url)

  const result = await pi.exec("curl", args, { timeout: FETCH_TIMEOUT })
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

async function jinaFetch(pi: ExtensionAPI, url: string): Promise<string> {
  const headers: Record<string, string> = { Accept: "text/markdown" }
  const key = getJinaKey()
  if (key) headers.Authorization = `Bearer ${key}`

  const { body, status } = await curlFetch(pi, `${FETCH_ENDPOINT}/${url}`, headers)
  if (status >= 400) {
    throw new Error(`Jina Reader returned HTTP ${status} for ${url}`)
  }
  return body
}

async function jinaSearch(pi: ExtensionAPI, query: string): Promise<string> {
  const key = getJinaKey()
  if (!key) throw new Error("no_jina_key")

  const encoded = encodeURIComponent(query)
  const { body, status } = await curlFetch(
    pi,
    `${SEARCH_ENDPOINT}/${encoded}`,
    { Accept: "text/markdown", Authorization: `Bearer ${key}` },
  )
  if (status >= 400) {
    throw new Error(`Jina Search returned HTTP ${status}`)
  }
  return body
}

async function ddgSearch(pi: ExtensionAPI, query: string): Promise<string> {
  const encoded = encodeURIComponent(query)
  const { body, status } = await curlFetch(pi, `${DDG_ENDPOINT}/?q=${encoded}`)
  if (status >= 400) {
    throw new Error(`DuckDuckGo returned HTTP ${status}`)
  }

  // Extract result links and snippets from DDG HTML
  const results: string[] = []
  const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*)*)<\/a>/gi

  let match
  const links: { url: string; title: string }[] = []
  while ((match = linkRegex.exec(body)) !== null) {
    const url = match[1].replace(/&amp;/g, "&")
    const title = match[2].replace(/<[^>]+>/g, "").trim()
    if (url.startsWith("http")) {
      links.push({ url, title })
    }
  }

  const snippets: string[] = []
  while ((match = snippetRegex.exec(body)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim())
  }

  for (let i = 0; i < links.length && i < 10; i++) {
    const snippet = snippets[i] ?? ""
    results.push(`${i + 1}. **${links[i].title}**\n   ${links[i].url}\n   ${snippet}`)
  }

  if (results.length === 0) {
    return "No results found."
  }

  return `Search results for: ${query}\n\n${results.join("\n\n")}`
}

export default function webToolsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and return its content as clean markdown. Uses Jina Reader to convert web pages to readable text. Good for documentation, articles, wiki pages, and any web content.",
    promptSnippet: "Fetch any URL as clean markdown for reading",
    promptGuidelines: [
      "Use web_fetch to read online documentation, wiki pages, articles, or any URL.",
      "Prefer web_fetch over bash curl for reading web content — it returns clean markdown.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Full URL to fetch (must start with http:// or https://)" }),
    }),

    async execute(_toolCallId, params, signal) {
      const url = params.url.trim()
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error(`Invalid URL: ${url} — must start with http:// or https://`)
      }

      const raw = await jinaFetch(pi, url)
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
      "Search the web for information. Returns a list of results with titles, URLs, and snippets. Uses Jina Search API if JINA_API_KEY is set, otherwise falls back to DuckDuckGo.",
    promptSnippet: "Search the web for documentation, solutions, or any information",
    promptGuidelines: [
      "Use web_search to find documentation, solutions, APIs, or any information online.",
      "After searching, use web_fetch to read the most relevant results in full.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),

    async execute(_toolCallId, params, signal) {
      const query = params.query.trim()
      let raw: string
      let source: string

      try {
        raw = await jinaSearch(pi, query)
        source = "jina"
      } catch (err: any) {
        if (err.message === "no_jina_key") {
          raw = await ddgSearch(pi, query)
          source = "duckduckgo"
        } else {
          throw err
        }
      }

      const { content, truncated } = truncate(raw, MAX_OUTPUT_BYTES)

      return {
        content: [{ type: "text" as const, text: content }],
        details: { query, source, truncated },
      }
    },
  })
}
