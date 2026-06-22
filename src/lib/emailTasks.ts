import { getRecentEmailsWithBody } from "./google";
import { chat } from "./anthropic";
import { listUpcoming } from "./localCalendar";
import { listGoals } from "./goals";

/** Local date as YYYY-MM-DD (kept local so briefing.ts can import this module). */
function todayStr(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

// A task candidate surfaced from an external source (email for now). The same
// "fetch → extract candidates → confirm" shape can later back Teams / WhatsApp:
// add a new fetcher + scan function returning this same candidate type.
export interface EmailTaskCandidate {
  emailId: string;
  from: string;
  subject: string;
  task: {
    title: string;
    date?: string; // absolute YYYY-MM-DD
    kind: "commitment" | "goal";
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SCAN_SYSTEM = `You scan a user's recent emails and extract ONLY concrete, actionable tasks the USER must personally do.
Ignore newsletters, promotions, marketing, automated notifications, receipts, calendar invites, and FYI-only mail. If an email contains no real task for the user, omit it entirely.

Return ONLY JSON of this exact shape (no prose):
{ "candidates": [ { "emailId": "...", "from": "...", "subject": "...", "task": { "title": "...", "date": "YYYY-MM-DD", "kind": "commitment" | "goal" } } ] }

Rules:
- title: a short, imperative description of what the user must do (e.g. "Reply to Sam with Q3 numbers", "Submit the visa form").
- date: OPTIONAL — include only if the email implies a due/needed date. Resolve relative dates ("by Friday", "tomorrow") to ABSOLUTE dates using today's date. Omit if there is no clear date.
- kind: "commitment" for a dated/discrete to-do (the default), "goal" for a larger ongoing objective.
- Do NOT suggest anything already in the ALREADY SAVED list (same underlying thing, regardless of wording or exact date).
- When unsure whether something is a real task, OMIT it. An empty array is fine.`;

function tryParse(raw: string): any {
  const match = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : raw);
}

/**
 * Fetch recent emails and extract task CANDIDATES via a single batched model
 * call. Does NOT write to any store — candidates are confirmed by the user in
 * the UI. Returns [] if there is nothing actionable.
 */
export async function scanInboxForTasks(
  userId: string
): Promise<EmailTaskCandidate[]> {
  const emails = await getRecentEmailsWithBody();
  if (emails.length === 0) return [];

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

  const emailBlocks = emails
    .map(
      (e, i) =>
        `[${i + 1}] emailId: ${e.id}\nfrom: ${e.from}\nsubject: ${e.subject}\nbody:\n${e.body}`
    )
    .join("\n---\n");

  const userMsg = `Today's date is ${todayStr()}.

${alreadySaved}

Emails:
${emailBlocks}

Extract the actionable task candidates as JSON now.`;

  const raw = await chat([{ role: "user", content: userMsg }], SCAN_SYSTEM, 1024);

  let parsed: any;
  try {
    parsed = tryParse(raw);
  } catch {
    return [];
  }

  const out: EmailTaskCandidate[] = [];
  for (const c of parsed.candidates ?? []) {
    const t = c?.task;
    if (!c?.emailId || !t?.title) continue;
    const kind = t.kind === "goal" ? "goal" : "commitment";
    const date =
      typeof t.date === "string" && DATE_RE.test(t.date) ? t.date : undefined;
    out.push({
      emailId: String(c.emailId),
      from: String(c.from ?? ""),
      subject: String(c.subject ?? ""),
      task: { title: String(t.title), date, kind },
    });
  }
  return out;
}
