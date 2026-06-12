import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * OpenCode Go provider extension.
 *
 * OpenCode Go is a low-cost subscription ($10/month, $5 first month) that gives
 * reliable API access to curated open-source coding models. Models are tested and
 * benchmarked specifically for coding agent use.
 *
 * Setup:
 *   1. Subscribe at https://opencode.ai/auth
 *   2. Copy your API key from the Zen console
 *   3. Set OPENCODE_GO_API_KEY in your environment (e.g. ~/.zshrc or ~/.bashrc)
 *   4. Restart pi — models appear in /model as "opencode-go/..."
 *
 * Models included:
 *   GLM-5          — via OpenAI-compatible endpoint
 *   Kimi K2.5      — via OpenAI-compatible endpoint (reasoning)
 *   MiniMax M2.5   — via Anthropic-compatible endpoint
 *   MiniMax M2.7   — via Anthropic-compatible endpoint
 *
 * Endpoints:
 *   OpenAI-compat:  https://opencode.ai/zen/go/v1/chat/completions
 *   Anthropic-compat: https://opencode.ai/zen/go/v1/messages
 *
 * Pricing (as of 2026-03):
 *   $5 first month, then $10/month — usage tracked at opencode.ai/auth
 *
 * Reference: https://opencode.ai/docs/go/
 */

const OPENAI_ENDPOINT = "https://opencode.ai/zen/go/v1"
const ANTHROPIC_ENDPOINT = "https://opencode.ai/zen/go/v1"
const API_KEY_ENV = "OPENCODE_GO_API_KEY"

export default function opencodeGoExtension(pi: ExtensionAPI) {
  const apiKey = process.env[API_KEY_ENV]

  if (!apiKey) {
    // Silently skip registration — no key, no models cluttering /model
    return
  }

  // GLM-5 and Kimi K2.5 — OpenAI Chat Completions compatible
  pi.registerProvider("opencode-go-openai", {
    baseUrl: OPENAI_ENDPOINT,
    apiKey: API_KEY_ENV,
    api: "openai-completions",
    models: [
      {
        id: "glm-5",
        name: "GLM-5 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5 (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
    ],
  })

  // MiniMax M2.5 and M2.7 — Anthropic Messages API compatible
  pi.registerProvider("opencode-go-anthropic", {
    baseUrl: ANTHROPIC_ENDPOINT,
    apiKey: API_KEY_ENV,
    api: "anthropic-messages",
    models: [
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 8192,
      },
      {
        id: "minimax-m2.7",
        name: "MiniMax M2.7 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 8192,
      },
    ],
  })
}
