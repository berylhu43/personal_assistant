import { selectOne, execute, uid } from "./db";
import { getTodayEvents } from "./google";
import { listTodayAndOverdue } from "./localCalendar";
import { listGoals } from "./goals";
import { listMemories } from "./memory";
import { chat } from "./anthropic";
import type {
  Briefing,
  BriefingRow,
  CalendarEvent,
  Commitment,
  Goal,
  Memory,
} from "./types";

/** Local date as YYYY-MM-DD. */
export function todayStr(d = new Date()): string {
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

function rowToBriefing(r: BriefingRow): Briefing {
  let notes: string[] = [];
  if (r.notes) {
    try {
      notes = JSON.parse(r.notes);
    } catch {
      notes = [];
    }
  }
  return { date: r.date, summary: r.summary, notes };
}

export async function getBriefing(
  userId: string,
  date = todayStr()
): Promise<Briefing | null> {
  const row = await selectOne<BriefingRow>(
    `SELECT * FROM briefings WHERE user_id = ?1 AND date = ?2`,
    [userId, date]
  );
  return row ? rowToBriefing(row) : null;
}

async function upsertBriefing(
  userId: string,
  date: string,
  summary: string,
  notes: string[]
): Promise<void> {
  await execute(
    `INSERT INTO briefings (id, user_id, date, summary, notes)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id, date) DO UPDATE SET
       summary = excluded.summary, notes = excluded.notes`,
    [uid(), userId, date, summary, JSON.stringify(notes)]
  );
}

function formatEvents(events: CalendarEvent[]): string {
  if (!events.length) return "  (none)";
  return events
    .map((e) => {
      const when = e.allDay
        ? "all day"
        : new Date(e.start).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
      return `  - [${e.day}] ${when} — ${e.title}`;
    })
    .join("\n");
}

function formatCommitments(commitments: Commitment[], today: string): string {
  if (!commitments.length) return "  (none)";
  return commitments
    .map((c) => {
      const overdue = c.date < today ? " (OVERDUE)" : "";
      const when = c.time ? `${c.date} ${c.time}` : c.date;
      return `  - ${when}${overdue} — ${c.title}`;
    })
    .join("\n");
}

function formatGoals(goals: Goal[]): string {
  if (!goals.length) return "  (none)";
  return goals
    .map((g) => `  - ${g.title} (${g.progress}%)`)
    .join("\n");
}

function formatMemoriesForBriefing(memories: Memory[]): string {
  if (!memories.length) return "  (none)";
  return memories.slice(0, 20).map((m) => `  - ${m.content}`).join("\n");
}

const BRIEFING_SYSTEM = `You write a terse morning briefing for a personal assistant memo widget.
You are given today's Google Calendar events, the user's LOCAL commitments (today + overdue), open goals, and long-term memory. Respond ONLY with JSON of the form:
{ "summary": "...", "notes": ["...", "..."] }
- summary: ONE or AT MOST TWO short sentences (hard cap). No preamble, no greeting filler — just what matters today.
- notes: 0–5 short bullets (fragments, not sentences) surfacing prep reminders for meetings, overdue/today commitments, goal nudges, and dependencies (e.g. buy ingredients the day before baking).
No prose outside the JSON.`;

/** Fetch context, ask Claude, persist, and return today's briefing. */
export async function generateBriefing(userId: string): Promise<Briefing> {
  const dateKey = todayStr();
  // Sources: calendar, local commitments, open goals, and long-term memory.
  // Email is intentionally excluded — email task extraction lives only in the
  // inbox panel (scanInboxForTasks).
  const [events, commitments, goals, memories] = await Promise.all([
    getTodayEvents().catch(() => [] as CalendarEvent[]),
    listTodayAndOverdue(userId, dateKey).catch(() => [] as Commitment[]),
    listGoals(userId).catch(() => [] as Goal[]),
    listMemories(userId).catch(() => [] as Memory[]),
  ]);

  const openGoals = goals.filter((g) => !g.done);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const userMsg = `Today is ${today}.

Google Calendar (today + tomorrow):
${formatEvents(events)}

Local commitments (today + overdue):
${formatCommitments(commitments, dateKey)}

Open goals:
${formatGoals(openGoals)}

Long-term memory about the user:
${formatMemoriesForBriefing(memories)}`;

  let summary = "Here's your day.";
  let notes: string[] = [];
  try {
    const raw = await chat([{ role: "user", content: userMsg }], BRIEFING_SYSTEM, 700);
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    summary = parsed.summary ?? summary;
    notes = Array.isArray(parsed.notes) ? parsed.notes : [];
  } catch {
    // Fall back to a minimal briefing if the model/JSON fails.
    summary = `${events.length} event(s) and ${commitments.length} commitment(s) today.`;
  }

  await upsertBriefing(userId, todayStr(), summary, notes);
  // Prune older briefings AFTER today's row exists, so the section is never
  // momentarily empty.
  await execute(`DELETE FROM briefings WHERE user_id = ?1 AND date < ?2`, [
    userId,
    todayStr(),
  ]);
  return { date: todayStr(), summary, notes };
}

/**
 * Return today's briefing, generating it on demand if it doesn't exist yet.
 * The UNIQUE(user_id, date) upsert keeps this safe against duplicates.
 */
export async function getOrGenerateBriefing(userId: string): Promise<Briefing> {
  const existing = await getBriefing(userId);
  if (existing) return existing;
  return generateBriefing(userId);
}
