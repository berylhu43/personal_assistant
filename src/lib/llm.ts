import { fetch } from "@tauri-apps/plugin-http";
import { getActiveProvider } from "./providers";
import { MissingApiKeyError } from "./anthropic";
import type { LlmProviderRow } from "./types";

// Unified LLM adapter layer. All non-web_search model calls route through here so
// the app can swap providers (Claude / GPT / DeepSeek / Qwen) behind one
// interface. Web search (study-plan) is intentionally NOT handled here yet — it
// still goes through anthropic.ts `chat()`.
//
// Transport is @tauri-apps/plugin-http (native/Rust layer) for every adapter —
// no WebView fetch, so no CORS and no Origin header.

export interface UnifiedMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: UnifiedMessage[];
  maxTokens: number;
}

export interface ChatResponse {
  text: string;
  // TODO(next): add a `usage` field for token-cost visualization.
}

export interface ProviderConfig {
  id: string;
  apiFormat: "anthropic" | "openai_compatible";
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LLMAdapter {
  readonly apiFormat: "anthropic" | "openai_compatible";
  complete(req: ChatRequest, cfg: ProviderConfig): Promise<ChatResponse>;
  completeJSON<T>(req: ChatRequest, cfg: ProviderConfig): Promise<T>;
}

/**
 * Thrown when the model's reply can't be parsed as JSON. Distinct from network /
 * API errors so callers can fall back on a parse miss while still letting real
 * call failures propagate (e.g. distill keeps its transcript on a network error
 * but treats unparseable output as an empty distillation).
 */
export class LLMParseError extends Error {
  constructor(message = "Model did not return valid JSON") {
    super(message);
    this.name = "LLMParseError";
  }
}

/**
 * Defensive JSON parse shared by both adapters: strip ```json fences, then match
 * the outer braces (handles models that wrap JSON in prose). Throws
 * LLMParseError on failure.
 */
function parseJsonLoose<T>(raw: string): T {
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```/g, "");
  const match = stripped.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : stripped) as T;
  } catch {
    throw new LLMParseError();
  }
}

// ---- Anthropic adapter ----

const ANTHROPIC_VERSION = "2023-06-01";

export const anthropicAdapter: LLMAdapter = {
  apiFormat: "anthropic",

  async complete(req, cfg) {
    const body = {
      model: cfg.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
    };

    const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        // Required even via plugin-http — keep it.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    // Concatenate text blocks (reproduces the original chat() behavior).
    const text = (data.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return { text };
  },

  async completeJSON<T>(req: ChatRequest, cfg: ProviderConfig): Promise<T> {
    // Anthropic has no JSON mode here — rely on the prompt + loose parse.
    const { text } = await this.complete(req, cfg);
    return parseJsonLoose<T>(text);
  },
};

// ---- OpenAI-compatible adapter (GPT / DeepSeek / Qwen, non-search) ----

// OpenAI's newer models (gpt-4.1 / gpt-5 / o-series) reject `max_tokens` on Chat
// Completions and require `max_completion_tokens`. DeepSeek/Qwen's OpenAI-
// compatible endpoints still use the original `max_tokens`. Branch on the
// provider id so each gets the field it accepts.
function maxTokensField(cfg: ProviderConfig): string {
  return cfg.id === "openai" ? "max_completion_tokens" : "max_tokens";
}

async function openaiChatCompletion(
  cfg: ProviderConfig,
  body: Record<string, unknown>
): Promise<any> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM API error ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export const openaiCompatAdapter: LLMAdapter = {
  apiFormat: "openai_compatible",

  async complete(req, cfg) {
    // System prompt is the first message in the OpenAI format.
    const messages = [
      { role: "system", content: req.system },
      ...req.messages,
    ];
    const data = await openaiChatCompletion(cfg, {
      model: cfg.model,
      [maxTokensField(cfg)]: req.maxTokens,
      messages,
    });
    return { text: data.choices?.[0]?.message?.content ?? "" };
  },

  async completeJSON<T>(req: ChatRequest, cfg: ProviderConfig): Promise<T> {
    const messages = [
      { role: "system", content: req.system },
      ...req.messages,
    ];
    // Prefer native JSON mode (GPT/DeepSeek support it); the loose parse below
    // still guards against models that wrap JSON in explanatory text.
    const data = await openaiChatCompletion(cfg, {
      model: cfg.model,
      [maxTokensField(cfg)]: req.maxTokens,
      messages,
      response_format: { type: "json_object" },
    });
    const text = data.choices?.[0]?.message?.content ?? "";
    return parseJsonLoose<T>(text);
  },
};

// ---- factory ----

/**
 * Resolve the active provider into a concrete adapter + its config. Throws
 * MissingApiKeyError (which hooks into friendlyError / the Settings prompt) when
 * no provider is active or the active one has no key.
 */
export async function getActiveAdapter(): Promise<{
  adapter: LLMAdapter;
  config: ProviderConfig;
}> {
  const p = await getActiveProvider();
  if (!p || !p.api_key) throw new MissingApiKeyError();

  const apiFormat: ProviderConfig["apiFormat"] =
    p.api_format === "anthropic" ? "anthropic" : "openai_compatible";
  const config: ProviderConfig = {
    id: p.id,
    apiFormat,
    baseUrl: p.base_url,
    model: p.default_model,
    apiKey: p.api_key,
  };
  const adapter =
    apiFormat === "anthropic" ? anthropicAdapter : openaiCompatAdapter;
  return { adapter, config };
}

/**
 * Send a tiny request to verify a provider's key actually works, so the user
 * finds out about a bad key in Settings rather than mid-task. Pass `overrideKey`
 * to test a key the user just typed but hasn't saved yet. Resolves on success;
 * throws (auth / network / API error) on failure.
 */
export async function testProviderConnection(
  provider: LlmProviderRow,
  overrideKey?: string
): Promise<void> {
  const apiKey = (overrideKey ?? provider.api_key ?? "").trim();
  if (!apiKey) throw new MissingApiKeyError();

  const apiFormat: ProviderConfig["apiFormat"] =
    provider.api_format === "anthropic" ? "anthropic" : "openai_compatible";
  const config: ProviderConfig = {
    id: provider.id,
    apiFormat,
    baseUrl: provider.base_url,
    model: provider.default_model,
    apiKey,
  };
  const adapter =
    apiFormat === "anthropic" ? anthropicAdapter : openaiCompatAdapter;

  // A minimal call: success (even empty text) means the key authenticated.
  await adapter.complete(
    { system: "", messages: [{ role: "user", content: "ping" }], maxTokens: 16 },
    config
  );
}
