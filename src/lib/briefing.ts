import { selectOne, execute, uid } from "./db";
import { getTodayEvents, getPendingEmails } from "./google";
import { listTodayAndOverdue } from "./localCalendar";
import { listGoals } from "./goals";
import { listMemories } from "./memory";
import { chat } from "./anthropic";
import type {
  Briefing,
  BriefingRow,
  CalendarEvent,
  PendingEmail,
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

function formatEmails(emails: PendingEmail[]): string {
  if (!emails.length) return "  (none)";
  return emails
    .map((e) => `  - [${e.tag}] ${e.from}: "${e.subject}" — ${e.snippet}`)
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

const BRIEFING_SYSTEM = `You write a short morning briefing for a personal assistant memo widget.
You are given today's Google Calendar events, the user's LOCAL commitments (today + overdue), open goals, long-term memory, and pending emails. Respond ONLY with JSON of the form:
{ "summary": "2-3 warm, concise sentences about the day", "notes": ["proactive item", "..."] }
The summary and notes should reflect local commitments and goals, not just the calendar. Notes should surface prep reminders for meetings, overdue/today commitments, goal nudges, dependencies (e.g. buy ingredients the day before baking), and timely email replies. Return 0-5 notes. No prose outside the JSON.`;

/** Fetch context, ask Claude, persist, and return today's briefing. */
export async function generateBriefing(userId: string): Promise<Briefing> {
  const dateKey = todayStr();
  const [events, emails, commitments, goals, memories] = await Promise.all([
    getTodayEvents().catch(() => [] as CalendarEvent[]),
    getPendingEmails().catch(() => [] as PendingEmail[]),
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
${formatMemoriesForBriefing(memories)}

Pending emails (last 48h):
${formatEmails(emails)}`;

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
    summary = `${events.length} event(s) and ${emails.length} email(s) need your attention today.`;
  }

  await upsertBriefing(userId, todayStr(), summary, notes);
  return { date: todayStr(), summary, notes };
}
