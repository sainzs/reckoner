import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * OpenCode Go provider extension.
 *
 * Two providers are required because the endpoint paths differ by API type:
 *
 *   openai-completions  → pi appends /chat/completions
 *                          base: https://opencode.ai/zen/go/v1
 *                          full: https://opencode.ai/zen/go/v1/chat/completions  ✓
 *
 *   anthropic-messages  → pi appends /v1/messages
 *                          base: https://opencode.ai/zen/go
 *                          full: https://opencode.ai/zen/go/v1/messages          ✓
 *
 * Using one base URL for both would double the /v1 for Anthropic → 404.
 *
 * Auth: pi resolves credentials for provider "opencode-go" from:
 *   - auth.json key "opencode-go"  (stored via /connect in pi)
 *   - env var OPENCODE_API_KEY
 *
 * Model IDs in pi:
 *   opencode-go/glm-5.1
 *   opencode-go/glm-5
 *   opencode-go/kimi-k2.6
 *   opencode-go/kimi-k2.5
 *   opencode-go/deepseek-v4-pro
 *   opencode-go/deepseek-v4-flash
 *   opencode-go/qwen3.6-plus
 *   opencode-go/qwen3.5-plus
 *   opencode-go/mimo-v2-pro
 *   opencode-go/mimo-v2-omni
 *   opencode-go/mimo-v2.5-pro
 *   opencode-go/mimo-v2.5
 *   opencode-go-minimax/minimax-m2.5
 *   opencode-go-minimax/minimax-m2.7
 */

const OPENAI_BASE = "https://opencode.ai/zen/go/v1"
const ANTHROPIC_BASE = "https://opencode.ai/zen/go"

const OPENAI_COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: "max_tokens",
}

export default function opencodeGoExtension(pi: ExtensionAPI) {
  // OpenCode Go models exposed via OpenAI Chat Completions compatible endpoint
  pi.registerProvider("opencode-go", {
    baseUrl: OPENAI_BASE,
    apiKey: "OPENCODE_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "glm-5.1",
        name: "GLM-5.1 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        compat: OPENAI_COMPAT,
      },
      {
        id: "glm-5",
        name: "GLM-5 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        compat: OPENAI_COMPAT,
      },
      {
        id: "kimi-k2.6",
        name: "Kimi K2.6 (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5 (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "qwen3.6-plus",
        name: "Qwen3.6 Plus (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "qwen3.5-plus",
        name: "Qwen3.5 Plus (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "mimo-v2-pro",
        name: "MiMo V2 Pro (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "mimo-v2-omni",
        name: "MiMo V2 Omni (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: OPENAI_COMPAT,
      },
      {
        id: "mimo-v2.5-pro",
        name: "MiMo V2.5 Pro (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 131072,
        compat: OPENAI_COMPAT,
      },
      {
        id: "mimo-v2.5",
        name: "MiMo V2.5 (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 131072,
        compat: OPENAI_COMPAT,
      },
    ],
  })

  // MiniMax M2.5 and M2.7 — Anthropic Messages API compatible
  // Separate provider because the base URL must omit /v1 (pi appends /v1/messages)
  pi.registerProvider("opencode-go-minimax", {
    baseUrl: ANTHROPIC_BASE,
    apiKey: "OPENCODE_API_KEY",
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
