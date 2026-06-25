import { fetch } from "@tauri-apps/plugin-http";
import { getApiKey } from "./store";
import { getProvider } from "./providers";
import type { ChatMessage } from "./types";

const MODEL = "claude-sonnet-4-6";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

/** Thrown when no Anthropic API key is stored — the UI should prompt for one. */
export class MissingApiKeyError extends Error {
  constructor() {
    super("No Anthropic API key configured");
    this.name = "MissingApiKeyError";
  }
}

/**
 * Call the Anthropic Messages API. The request goes through
 * @tauri-apps/plugin-http, which executes on the native (Rust) layer — there is
 * no WebView involvement, no Origin header, and therefore no CORS at all. The
 * key is read from the local store and never hardcoded.
 */
export async function chat(
  messages: ChatMessage[],
  systemPrompt: string,
  maxTokens = 1024,
  opts?: { webSearch?: boolean }
): Promise<string> {
  // Key source of truth is the anthropic row in llm_providers (managed in
  // Settings); fall back to the legacy settings.json key if the row is empty.
  const apiKey = (await getProvider("anthropic"))?.api_key || (await getApiKey());
  if (!apiKey) throw new MissingApiKeyError();

  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };
  // Opt-in server-side web search. When enabled the response interleaves
  // server_tool_use / web_search_tool_result blocks among the text blocks — we
  // still return only the concatenated text. Off by default (normal chat is
  // search-free and cheap).
  if (opts?.webSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const dbg = opts?.webSearch;
  if (dbg)
    console.log("[plan-debug] chat: sending request, webSearch=true, max_tokens", maxTokens);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body),
  });

  if (dbg) console.log("[plan-debug] chat: fetch returned, status", res.status);

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (dbg) console.error("[plan-debug] chat: error body", detail.slice(0, 500));
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  if (dbg)
    console.log(
      "[plan-debug] chat: content block types",
      (data.content ?? []).map((b: any) => b.type)
    );
  // Multi-block responses are expected (text + tool-use/result). Keep text only.
  return (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}
