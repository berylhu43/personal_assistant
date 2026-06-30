import { getRecentEmailsWithBody } from "./google";
import { getActiveAdapter, LLMParseError } from "./llm";
import { listUpcoming } from "./localCalendar";
import { listGoals } from "./goals";
import { selectOne, execute } from "./db";
import { isTeamsConnected } from "./msAuth";
import { scanTeamsForTasks } from "./teamsTasks";
import type { InboxTaskCandidate } from "./types";

/** Local date as YYYY-MM-DD (kept local so briefing.ts can import this module). */
function todayStr(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

// The Inbox shows task candidates from multiple sources (email + Teams), all in
// the unified InboxTaskCandidate shape so they render in one list. Each scanner
// (here for email, teamsTasks.ts for Teams) returns that same shape.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SCAN_SYSTEM = `You scan a user's recent emails and extract items worth putting on their to-do / calendar list. TWO kinds qualify:
1. ACTIONABLE TASKS the user must personally do (e.g. "Reply to Sam with Q3 numbers", "Submit the visa form").
2. DATED EVENTS / COMMITMENTS the user should have on their calendar — flights, train/bus tickets, hotel or Airbnb check-in/check-out, reservations, appointments, interviews, deliveries with a date, bookings, or anything scheduled that involves the user (including from automated confirmations and itineraries).

Ignore pure marketing: newsletters, promotions, sales/marketing blasts, and social notifications. Also ignore generic receipts that have no upcoming date. If an email has NEITHER a real task NOR a dated event for the user, omit it entirely.

Return ONLY JSON of this exact shape (no prose):
{ "candidates": [ { "emailId": "...", "from": "...", "subject": "...", "task": { "title": "...", "date": "YYYY-MM-DD", "kind": "commitment" | "goal" } } ] }

Rules:
- title: a short PLAIN-TEXT description. For a task, make it imperative ("Submit the visa form"). For a dated event, name it concretely with key details ("Flight to SFO — UA 123 6:40am", "Hotel check-in: Marriott Seattle", "Dentist appointment 2pm").
- date: include the relevant date whenever there is one — a flight/reservation/appointment date, or a task's due date. Resolve relative dates ("by Friday", "tomorrow") to ABSOLUTE dates using today's date. Omit only if there is genuinely no date.
- kind: "commitment" for a dated/discrete item — use this for travel, reservations, appointments, and most tasks; "goal" only for a larger ongoing objective.
- Do NOT suggest anything already in the ALREADY SAVED list (same underlying thing, regardless of wording or exact date).
- When unsure whether something is real and relevant to the user, OMIT it. An empty array is fine.
- The "title" must be PLAIN TEXT — never include emoji, icons, or decorative symbols.`;

/**
 * Fetch recent emails and extract task CANDIDATES via a single batched model
 * call. Does NOT write to any store — candidates are confirmed by the user in
 * the UI. Returns [] if there is nothing actionable.
 */
export async function scanInboxForTasks(
  userId: string
): Promise<InboxTaskCandidate[]> {
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

  const out: InboxTaskCandidate[] = [];
  for (const c of parsed.candidates ?? []) {
    const t = c?.task;
    if (!c?.emailId || !t?.title) continue;
    const kind = t.kind === "goal" ? "goal" : "commitment";
    const date =
      typeof t.date === "string" && DATE_RE.test(t.date) ? t.date : undefined;
    out.push({
      source: "email",
      sourceId: String(c.emailId),
      from: String(c.from ?? ""),
      subject: String(c.subject ?? ""),
      task: { title: String(t.title), date, kind },
    });
  }
  return out;
}

/**
 * Scan ALL connected sources (email + Teams) and merge into one candidate list.
 * Teams is only scanned when connected. Each source is independently resilient
 * so one failing doesn't drop the other.
 */
async function scanAllSources(userId: string): Promise<InboxTaskCandidate[]> {
  const [email, teams] = await Promise.all([
    scanInboxForTasks(userId).catch(() => [] as InboxTaskCandidate[]),
    isTeamsConnected().then((on) =>
      on
        ? scanTeamsForTasks(userId).catch(() => [] as InboxTaskCandidate[])
        : ([] as InboxTaskCandidate[])
    ),
  ]);
  return [...email, ...teams];
}

// ---- daily cache (one scan per day; manual refresh re-spends tokens) ----

async function writeCache(
  userId: string,
  candidates: InboxTaskCandidate[]
): Promise<void> {
  await execute(
    `INSERT INTO inbox_scans (user_id, date, candidates)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id, date) DO UPDATE SET
       candidates = excluded.candidates, created_at = datetime('now')`,
    [userId, todayStr(), JSON.stringify(candidates)]
  );
}

/**
 * Return today's inbox candidates from cache if present; otherwise run the scan
 * (one model call), cache it for today, and return it. Mirrors the briefing's
 * get-or-generate pattern so re-expanding the same day costs no tokens.
 */
export async function getOrScanInbox(
  userId: string
): Promise<InboxTaskCandidate[]> {
  const row = await selectOne<{ candidates: string }>(
    `SELECT candidates FROM inbox_scans WHERE user_id = ?1 AND date = ?2`,
    [userId, todayStr()]
  );
  if (row) {
    try {
      const parsed = JSON.parse(row.candidates);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to a fresh scan */
    }
  }
  const candidates = await scanAllSources(userId);
  await writeCache(userId, candidates);
  return candidates;
}

/** Force a fresh scan, overwriting today's cache. Backs the manual Refresh. */
export async function rescanInbox(
  userId: string
): Promise<InboxTaskCandidate[]> {
  const candidates = await scanAllSources(userId);
  await writeCache(userId, candidates);
  return candidates;
}

/** Overwrite today's cached candidates (after an Add/Dismiss removes one). */
export async function setCachedInbox(
  userId: string,
  candidates: InboxTaskCandidate[]
): Promise<void> {
  await writeCache(userId, candidates);
}
