import { select, execute, uid } from "./db";
import { chat } from "./anthropic";
import { createEvent } from "./google";
import { createGoal } from "./goals";
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

export async function recentMessages(
  userId: string,
  limit = 20
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
  return memories.map((m) => `  - (${m.kind}) ${m.content}`).join("\n");
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

You can take actions by emitting fenced JSON blocks anywhere in your reply. The app parses and executes them, then hides them from the user. Use them when appropriate:

1. Add a calendar event:
\`\`\`add-event
{ "title": "...", "date": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm", "description": "..." }
\`\`\`

2. Save a goal to the user's todo list (with an optional weekly plan):
\`\`\`goal
{ "title": "...", "plan": [ { "week": 1, "focus": "..." } ] }
\`\`\`

3. Remember a durable fact/preference about the user:
\`\`\`remember
{ "kind": "fact" | "preference" | "goal_note", "content": "..." }
\`\`\`

Always also write a normal, friendly message for the user alongside any blocks.`;
}

// ---- block parsing ----

interface ParsedActions {
  clean: string;
  events: NewEvent[];
  goals: { title: string; plan?: WeeklyPlanItem[] }[];
  memories: { kind: MemoryKind; content: string }[];
}

const BLOCK_RE = /```(add-event|goal|remember)\s*([\s\S]*?)```/g;

export function parseBlocks(raw: string): ParsedActions {
  const events: NewEvent[] = [];
  const goals: { title: string; plan?: WeeklyPlanItem[] }[] = [];
  const memories: { kind: MemoryKind; content: string }[] = [];

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
    } catch {
      /* skip malformed block */
    }
  }

  const clean = raw.replace(BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { clean, events, goals, memories };
}

// ---- one chat turn ----

export interface ChatTurnResult {
  reply: string;
  createdGoal: boolean;
  createdEvent: boolean;
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
  const { clean, events, goals, memories: newMemories } = parseBlocks(raw);

  let createdEvent = false;
  let createdGoal = false;

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

  const visible = clean || "Done.";
  await addMessage(userId, "assistant", visible);

  return { reply: visible, createdGoal, createdEvent };
}
