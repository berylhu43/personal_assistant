import { select, execute, uid } from "./db";
import { chat } from "./anthropic";
import { createEvent } from "./google";
import { saveGoal, listGoals, setGoalDone, deleteGoal } from "./goals";
import {
  createCommitment,
  listUpcoming,
  setCommitmentDone,
  deleteCommitment,
} from "./localCalendar";
import { addMemory } from "./memory";
import { listMemories } from "./memory";
import type {
  ChatMessage,
  MessageRow,
  CalendarEvent,
  PendingEmail,
  Memory,
  Goal,
  Commitment,
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

function formatGoals(goals: Goal[]): string {
  if (!goals.length) return "  (no goals)";
  return goals
    .map(
      (g) =>
        `  - [id: ${g.id}] ${g.title} — ${g.progress}%${
          g.targetDate ? ` (by ${g.targetDate})` : ""
        }`
    )
    .join("\n");
}

function formatCommitments(commitments: Commitment[]): string {
  if (!commitments.length) return "  (no commitments)";
  return commitments
    .map(
      (c) =>
        `  - [id: ${c.id}] ${c.date}${c.time ? ` ${c.time}` : ""} — ${c.title}`
    )
    .join("\n");
}

export function buildSystemPrompt(
  events: CalendarEvent[],
  emails: PendingEmail[],
  memories: Memory[],
  goals: Goal[],
  commitments: Commitment[]
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

Your current goals:
${formatGoals(goals)}

Your calendar (local commitments):
${formatCommitments(commitments)}

Behaviors:
- Help plan goals. When the user states a goal, break it into a concrete weekly plan and propose calendar time blocks.
- Detect dependencies and give reminders (e.g. "baking a cake Sunday" → "buy ingredients Saturday").
- Be proactive about prep for meetings happening tomorrow.
- You can SEE the user's goals and commitments above (each line shows its id). You may modify them — complete or delete — but ONLY when the user explicitly asks (e.g. "mark the reading goal done", "cancel my dentist commitment"). Use the exact id from the lists above.
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

5. Mark a goal complete (use the id from "Your current goals"):
\`\`\`complete-goal
{ "id": "..." }
\`\`\`

6. Delete a goal:
\`\`\`delete-goal
{ "id": "..." }
\`\`\`

7. Mark a commitment done (use the id from "Your calendar"):
\`\`\`complete-commitment
{ "id": "..." }
\`\`\`

8. Delete a commitment:
\`\`\`delete-commitment
{ "id": "..." }
\`\`\`

To MODIFY a commitment (e.g. move it to tomorrow, change the details), there is no update block: emit a \`delete-commitment\` for the old id AND a new \`commitment\` block with the updated date/time/title.

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
  completeGoals: string[];
  deleteGoals: string[];
  completeCommitments: string[];
  deleteCommitments: string[];
}

const BLOCK_RE =
  /```(add-event|goal|remember|commitment|complete-goal|delete-goal|complete-commitment|delete-commitment)\s*([\s\S]*?)```/g;

export function parseBlocks(raw: string): ParsedActions {
  const events: NewEvent[] = [];
  const goals: { title: string; plan?: WeeklyPlanItem[] }[] = [];
  const memories: { kind: MemoryKind; content: string }[] = [];
  const commitments: ParsedCommitment[] = [];
  const completeGoals: string[] = [];
  const deleteGoals: string[] = [];
  const completeCommitments: string[] = [];
  const deleteCommitments: string[] = [];

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
      else if (kind === "complete-goal" && json.id) completeGoals.push(json.id);
      else if (kind === "delete-goal" && json.id) deleteGoals.push(json.id);
      else if (kind === "complete-commitment" && json.id)
        completeCommitments.push(json.id);
      else if (kind === "delete-commitment" && json.id)
        deleteCommitments.push(json.id);
    } catch {
      /* skip malformed block */
    }
  }

  const clean = raw.replace(BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    clean,
    events,
    goals,
    memories,
    commitments,
    completeGoals,
    deleteGoals,
    completeCommitments,
    deleteCommitments,
  };
}

// ---- one chat turn ----

export interface ChatTurnResult {
  reply: string;
  createdGoal: boolean;
  createdEvent: boolean;
  createdCommitment: boolean;
}

/**
 * Execute the explicit, in-the-moment actions parsed from the assistant reply.
 * Returns flags so the UI knows which panels to refresh.
 */
async function applyActions(
  userId: string,
  p: ParsedActions
): Promise<{ createdGoal: boolean; createdEvent: boolean; createdCommitment: boolean }> {
  let createdEvent = false;
  let createdGoal = false;
  let createdCommitment = false;

  for (const ev of p.events) {
    try {
      await createEvent(ev);
      createdEvent = true;
    } catch {
      /* surface failures softly; reply text still shown */
    }
  }
  for (const g of p.goals) {
    await saveGoal({ userId, title: g.title, plan: g.plan ?? null });
    createdGoal = true;
  }
  for (const m of p.memories) {
    await addMemory({ userId, kind: m.kind, content: m.content });
  }
  for (const c of p.commitments) {
    await createCommitment({
      userId,
      title: c.title,
      date: c.date,
      time: c.time ?? null,
      source: "chat",
    });
    createdCommitment = true;
  }
  for (const id of p.completeGoals) {
    await setGoalDone(id, true);
    createdGoal = true;
  }
  for (const id of p.deleteGoals) {
    await deleteGoal(id);
    createdGoal = true;
  }
  for (const id of p.completeCommitments) {
    await setCommitmentDone(id, true);
    createdCommitment = true;
  }
  for (const id of p.deleteCommitments) {
    await deleteCommitment(id);
    createdCommitment = true;
  }

  return { createdGoal, createdEvent, createdCommitment };
}

/**
 * Persist the user's message, build the context-aware prompt (memory, goals,
 * commitments), call Claude, act on any fenced blocks, persist the assistant
 * reply, and return the cleaned visible text plus flags for what changed.
 */
export async function runChatTurn(
  userId: string,
  userText: string,
  ctx: { events: CalendarEvent[]; emails: PendingEmail[] }
): Promise<ChatTurnResult> {
  await addMessage(userId, "user", userText);

  const [memories, goals, commitments, history] = await Promise.all([
    listMemories(userId),
    listGoals(userId).then((gs) => gs.filter((g) => !g.done)),
    listUpcoming(userId),
    recentMessages(userId, 20),
  ]);

  const system = buildSystemPrompt(
    ctx.events,
    ctx.emails,
    memories,
    goals,
    commitments
  );
  const raw = await chat(history, system);
  const parsed = parseBlocks(raw);

  const { createdGoal, createdEvent, createdCommitment } = await applyActions(
    userId,
    parsed
  );

  const visible = parsed.clean || "Done.";
  await addMessage(userId, "assistant", visible);

  return { reply: visible, createdGoal, createdEvent, createdCommitment };
}
