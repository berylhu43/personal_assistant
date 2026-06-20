import { fetch } from "@tauri-apps/plugin-http";
import { getApiKey } from "./store";
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
 * Call the Anthropic Messages API. Goes through the Tauri HTTP plugin (Rust
 * transport) so there is no browser CORS restriction. The key is read from the
 * local store and never hardcoded.
 */
export async function chat(
  messages: ChatMessage[],
  systemPrompt: string,
  maxTokens = 1024
): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new MissingApiKeyError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // The webview sends an Origin header, so Anthropic treats this as a
      // browser request. Safe here: the key is stored locally in a desktop app.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}
