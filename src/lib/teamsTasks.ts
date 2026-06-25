import { getTeamsMessages } from "./teams";
import { getActiveAdapter, LLMParseError } from "./llm";
import { listUpcoming } from "./localCalendar";
import { listGoals } from "./goals";
import type { InboxTaskCandidate } from "./types";

/** Local date as YYYY-MM-DD. */
function todayStr(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Mirrors emailTasks.ts SCAN_SYSTEM, adapted for Teams DMs/@mentions. The model
// only needs to echo back the messageId + the task; sender/context come from our
// own message list (more reliable than trusting the model to repeat them).
const SCAN_SYSTEM = `You scan a user's recent Microsoft Teams messages (1:1 direct messages and messages where they were @mentioned) and extract ONLY concrete, actionable tasks the USER must personally do.
Ignore greetings, FYI/heads-up chatter, reactions, social messages, and anything automated. If a message contains no real task for the user, omit it entirely.

Return ONLY JSON of this exact shape (no prose):
{ "candidates": [ { "messageId": "...", "task": { "title": "...", "date": "YYYY-MM-DD", "kind": "commitment" | "goal" } } ] }

Rules:
- messageId: copy the exact id from the message you extracted the task from.
- title: a short, imperative description of what the user must do (e.g. "Send Priya the budget draft", "Review the PR before standup").
- date: OPTIONAL — include only if the message implies a due/needed date. Resolve relative dates ("by Friday", "tomorrow", "EOD") to ABSOLUTE dates using today's date. Omit if there is no clear date.
- kind: "commitment" for a dated/discrete to-do (the default), "goal" for a larger ongoing objective.
- Do NOT suggest anything already in the ALREADY SAVED list (same underlying thing, regardless of wording or exact date).
- When unsure whether something is a real task, OMIT it. An empty array is fine.
- The "title" must be PLAIN TEXT — never include emoji, icons, or decorative symbols.`;

/**
 * Fetch recent Teams DMs/@mentions and extract task CANDIDATES via a single
 * batched model call. Does NOT write to any store — candidates are confirmed by
 * the user in the Inbox UI. Returns [] if there is nothing actionable.
 */
export async function scanTeamsForTasks(
  userId: string
): Promise<InboxTaskCandidate[]> {
  const messages = await getTeamsMessages();
  if (messages.length === 0) return [];

  const [commitments, goals] = await Promise.all([
    listUpcoming(userId).catch(() => []),
    listGoals(userId)
      .then((gs) => gs.filter((g) => !g.done))
      .catch(() => []),
  ]);

  const alreadySaved = `ALREADY SAVED — do not suggest these:
Goals:
${goals.length ? goals.map((g) => `  - ${g.title}`).join("\n") : "  (none)"}
Commitments:
${commitments.length ? commitments.map((c) => `  - ${c.date} ${c.title}`).join("\n") : "  (none)"}`;

  const blocks = messages
    .map(
      (m, i) =>
        `[${i + 1}] messageId: ${m.id}\nfrom: ${m.from}\ntype: ${
          m.reason === "dm" ? "direct message" : "@mention"
        }\nmessage:\n${m.preview}`
    )
    .join("\n---\n");

  const userMsg = `Today's date is ${todayStr()}.

${alreadySaved}

Teams messages:
${blocks}

Extract the actionable task candidates as JSON now.`;

  let parsed: any;
  try {
    const { adapter, config } = await getActiveAdapter();
    parsed = await adapter.completeJSON<any>(
      {
        system: SCAN_SYSTEM,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 1024,
      },
      config
    );
  } catch (e) {
    if (e instanceof LLMParseError) return []; // unparseable → nothing actionable
    throw e; // network/API/no-key → let the caller surface it
  }

  // Map messageId → message so sender/context come from authoritative data.
  const byId = new Map(messages.map((m) => [m.id, m]));

  const out: InboxTaskCandidate[] = [];
  for (const c of parsed.candidates ?? []) {
    const t = c?.task;
    if (!c?.messageId || !t?.title) continue;
    const msg = byId.get(String(c.messageId));
    const kind = t.kind === "goal" ? "goal" : "commitment";
    const date =
      typeof t.date === "string" && DATE_RE.test(t.date) ? t.date : undefined;
    out.push({
      source: "teams",
      sourceId: String(c.messageId),
      from: msg?.from ?? "Teams",
      subject: msg?.reason === "mention" ? "@mention" : "Direct message",
      task: { title: String(t.title), date, kind },
    });
  }
  return out;
}
