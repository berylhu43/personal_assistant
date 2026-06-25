import { fetch } from "@tauri-apps/plugin-http";
import type { ProviderConfig } from "./llm";

// GPT web search lives ONLY on the OpenAI **Responses** API (Chat Completions
// has no web_search tool) — so this is a deliberately separate path from
// OpenAICompatAdapter. Used only by the study-plan feature when the active
// provider is GPT. Transport stays @tauri-apps/plugin-http for consistency.

// gpt-5 series spends MANY reasoning tokens before emitting the final answer; if
// max_output_tokens is too small the call returns status:'incomplete' with no
// answer text but still bills the tokens. Keep this high (>= 8192).
const MAX_OUTPUT_TOKENS = 8192;

export interface SearchResult {
  text: string;
  sources: { url: string; title: string }[];
}

/** Thrown when the Responses API runs out of budget / stops before a final
 * answer. Distinct + clearly worded so it reads well in the friendly-error path. */
export class IncompleteResponseError extends Error {
  constructor(reason: string) {
    super(`The web search didn't finish (incomplete: ${reason})`);
    this.name = "IncompleteResponseError";
  }
}

/**
 * One web-search-backed request through the OpenAI Responses API. Returns the
 * final answer text plus the REAL source links (url_citation annotations).
 *
 * The Responses API returns a typed `output` array (NOT `choices`): we find the
 * `message` item for the text, confirm a `web_search_call` item actually ran,
 * and read `url_citation` annotations off the message for the sources.
 */
export async function researchWithSearch(
  prompt: string,
  cfg: ProviderConfig
): Promise<SearchResult> {
  const res = await fetch(`${cfg.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input: prompt,
      tools: [{ type: "web_search" }],
      max_output_tokens: MAX_OUTPUT_TOKENS,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenAI Responses API error ${res.status}: ${detail.slice(0, 200)}`
    );
  }

  const data = await res.json();

  // Too-small a token budget (or other caps) → no usable answer, but billed.
  if (data.status === "incomplete") {
    throw new IncompleteResponseError(
      data.incomplete_details?.reason ?? "unknown"
    );
  }

  const output: any[] = data.output ?? [];
  // Confirm a search actually happened (vs the model answering from memory).
  const webSearchCall = output.some((o) => o.type === "web_search_call");

  const message = output.find((o) => o.type === "message");
  const textPart = (message?.content ?? []).find(
    (c: any) => c.type === "output_text"
  );
  const text: string = textPart?.text ?? "";

  const sources = ((textPart?.annotations ?? []) as any[])
    .filter((a) => a.type === "url_citation")
    .map((a) => ({ url: String(a.url), title: String(a.title ?? a.url) }));

  // TEMP verification (remove later): confirms search ran + real citations came back.
  console.log("[plan-debug] GPT Responses:", {
    status: data.status,
    webSearchCall,
    sources: sources.length,
    textLen: text.length,
  });

  if (!text) {
    throw new Error("OpenAI Responses API returned no answer text");
  }

  return { text, sources };
}
