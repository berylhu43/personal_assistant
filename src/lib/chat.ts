import { select, execute, uid } from "./db";
import { chat } from "./anthropic";
import { createEvent } from "./google";
import { createGoal } from "./goals";
import { createCommitment } from "./localCalendar";
import { addMemory } from "./memory";
import { listMemories } from "./memory";
import type {
  ChatMessage,
  MessageRow,
  CalendarEvent,
  PendingEmail,
  Memory,
  NewEvent,
  WeeklyPlanItem,
  MemoryKind,
} from "./types";

// ---- message persistence ----

export async function addMessage(
  userId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await execute(
    `INSERT INTO messages (id, user_id, role, content) VALUES (?1, ?2, ?3, ?4)`,
    [uid(), userId, role, content]
  );
}

/**
 * The CURRENT conversation's messages in chronological order (capped). The
 * messages table holds only the active session — it is cleared when the
 * conversation closes (or distilled + cleared on next launch), so this is not a
 * cross-session replay.
 */
export async function recentMessages(
  userId: string,
  limit = 50
): Promise<ChatMessage[]> {
  const rows = await select<MessageRow>(
    `SELECT * FROM messages WHERE user_id = ?1
     ORDER BY created_at DESC, rowid DESC LIMIT ?2`,
    [userId, limit]
  );
  // Reverse to chronological order.
  const msgs = rows
    .reverse()
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
  // Anthropic requires the first message to be from the user.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

/** Clear the current conversation's messages (called after distillation). */
export async function clearMessages(userId: string): Promise<void> {
  await execute(`DELETE FROM messages WHERE user_id = ?1`, [userId]);
}

/** Whether any session messages exist (e.g. a session left over from a prior run). */
export async function hasMessages(userId: string): Promise<boolean> {
  const row = await select<{ one: number }>(
    `SELECT 1 AS one FROM messages WHERE user_id = ?1 LIMIT 1`,
    [userId]
  );
  return row.length > 0;
}

// ---- system prompt ----

function formatEvents(events: CalendarEvent[]): string {
  if (!events.length) return "  (no events)";
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
  if (!emails.length) return "  (no pending emails)";
  return emails
    .map((e) => `  - [${e.tag}] ${e.from}: "${e.subject}"`)
    .join("\n");
}

function formatMemories(memories: Memory[]): string {
  if (!memories.length) return "  (nothing remembered yet)";
  return memories
    .map((m) => `  - (${m.kind}, noted ${m.createdAt.slice(0, 10)}) ${m.content}`)
    .join("\n");
}

export function buildSystemPrompt(
  events: CalendarEvent[],
  emails: PendingEmail[],
  memories: Memory[]
): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `You are a proactive personal assistant living in an always-on desktop memo widget.

Today's date is ${today}.

Calendar (today + tomorrow):
${formatEvents(events)}

Pending emails (last 48h):
${formatEmails(emails)}

What you remember about the user:
${formatMemories(memories)}

Behaviors:
- Help plan goals. When the user states a goal, break it into a concrete weekly plan and propose calendar time blocks.
- Detect dependencies and give reminders (e.g. "baking a cake Sunday" → "buy ingredients Saturday").
- Be proactive about prep for meetings happening tomorrow.
- Keep replies concise, warm, and practical.

You can take actions by emitting fenced JSON blocks anywhere in your reply. The app parses and executes them, then hides them from the user.

CRITICAL — explicit only: emit a block ONLY for an action the user EXPLICITLY requests in their current message (e.g. "add X to my todos", "remind me to buy milk Saturday", "put this on my Google Calendar"). Do NOT opportunistically save things merely mentioned in passing — durable info is captured automatically when the conversation ends, so there is no need to record it mid-chat. When in doubt, emit nothing and just reply.

1. Save a goal to the user's todo list (with an optional weekly plan):
\`\`\`goal
{ "title": "...", "plan": [ { "week": 1, "focus": "..." } ] }
\`\`\`

2. Remember a durable fact/preference about the user:
\`\`\`remember
{ "kind": "fact" | "preference" | "goal_note", "content": "..." }
\`\`\`
Rules for \`remember\` — follow strictly:
- Only durable, time-stable facts/preferences, e.g. "prefers morning meetings", "is learning AI agents", "allergic to nuts".
- NEVER appointments/events or anything phrased relative to time ("tomorrow", "this weekend", "明天", "今天"). Dated commitments belong in the local calendar — use the \`commitment\` block.

3. Add a discrete dated commitment to the LOCAL calendar (stays on this machine, not synced to Google):
\`\`\`commitment
{ "title": "...", "date": "YYYY-MM-DD", "time": "HH:mm", "note": "..." }
\`\`\`
Use an ABSOLUTE date (resolve "tomorrow"/"Friday" against today's date above). "time" and "note" are optional. This is the default for reminders and dated to-dos.

4. Add an event to the user's GOOGLE Calendar — ONLY when the user explicitly asks to put something on their Google Calendar:
\`\`\`add-event
{ "title": "...", "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm", "description": "..." }
\`\`\`
Never auto-create Google Calendar events from general statements; default to \`commitment\` instead.

Always also write a normal, friendly message for the user alongside any blocks.`;
}

// ---- block parsing ----

interface ParsedCommitment {
  title: string;
  date: string;
  time?: string;
}

interface ParsedActions {
  clean: string;
  events: NewEvent[];
  goals: { title: string; plan?: WeeklyPlanItem[] }[];
  memories: { kind: MemoryKind; content: string }[];
  commitments: ParsedCommitment[];
}

const BLOCK_RE = /```(add-event|goal|remember|commitment)\s*([\s\S]*?)```/g;

export function parseBlocks(raw: string): ParsedActions {
  const events: NewEvent[] = [];
  const goals: { title: string; plan?: WeeklyPlanItem[] }[] = [];
  const memories: { kind: MemoryKind; content: string }[] = [];
  const commitments: ParsedCommitment[] = [];

  let match: RegExpExecArray | null;
  while ((match = BLOCK_RE.exec(raw)) !== null) {
    const [, kind, body] = match;
    try {
      const json = JSON.parse(body.trim());
      if (kind === "add-event" && json.title && json.date) events.push(json);
      else if (kind === "goal" && json.title)
        goals.push({ title: json.title, plan: json.plan });
      else if (kind === "remember" && json.content)
        memories.push({ kind: json.kind ?? "fact", content: json.content });
      else if (kind === "commitment" && json.title && json.date)
        commitments.push({ title: json.title, date: json.date, time: json.time });
    } catch {
      /* skip malformed block */
    }
  }

  const clean = raw.replace(BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { clean, events, goals, memories, commitments };
}

// ---- one chat turn ----

export interface ChatTurnResult {
  reply: string;
  createdGoal: boolean;
  createdEvent: boolean;
  createdCommitment: boolean;
}

/**
 * Persist the user's message, build the memory-aware prompt, call Claude,
 * act on any fenced blocks, persist the assistant reply, and return the
 * cleaned visible text plus flags for what changed.
 */
export async function runChatTurn(
  userId: string,
  userText: string,
  ctx: { events: CalendarEvent[]; emails: PendingEmail[] }
): Promise<ChatTurnResult> {
  await addMessage(userId, "user", userText);

  const [memories, history] = await Promise.all([
    listMemories(userId),
    recentMessages(userId, 20),
  ]);

  const system = buildSystemPrompt(ctx.events, ctx.emails, memories);
  const raw = await chat(history, system);
  const {
    clean,
    events,
    goals,
    memories: newMemories,
    commitments,
  } = parseBlocks(raw);

  let createdEvent = false;
  let createdGoal = false;
  let createdCommitment = false;

  for (const ev of events) {
    try {
      await createEvent(ev);
      createdEvent = true;
    } catch {
      /* surface failures softly; reply text still shown */
    }
  }
  for (const g of goals) {
    await createGoal({ userId, title: g.title, plan: g.plan ?? null });
    createdGoal = true;
  }
  for (const m of newMemories) {
    await addMemory({ userId, kind: m.kind, content: m.content });
  }
  for (const c of commitments) {
    await createCommitment({
      userId,
      title: c.title,
      date: c.date,
      time: c.time ?? null,
      source: "chat",
    });
    createdCommitment = true;
  }

  const visible = clean || "Done.";
  await addMessage(userId, "assistant", visible);

  return { reply: visible, createdGoal, createdEvent, createdCommitment };
}
