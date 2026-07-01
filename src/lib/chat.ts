import { select, execute, uid } from "./db";
import { getActiveAdapter } from "./llm";
import { createEvent } from "./google";
import {
  saveGoal,
  listGoals,
  setGoalDone,
  setGoalTaskTotal,
  setGoalGranularity,
  deleteGoal,
} from "./goals";
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
  TeamsMessage,
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

function formatTeams(messages: TeamsMessage[]): string {
  if (!messages.length) return "  (no Teams messages needing attention)";
  return messages
    .map((m) => {
      const label = m.reason === "dm" ? "DM" : "mention";
      return `  - [${label}] ${m.from}: "${m.preview}"`;
    })
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
  teams: TeamsMessage[],
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

Teams messages needing attention (1:1 DMs + @mentions, last 7 days):
${formatTeams(teams)}

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

TITLES: all titles (goals, commitments, events) must be PLAIN TEXT — never include emoji, icons, or decorative symbols.

PLANS — clarify content first, then hand off to the app; never build inline: If the user wants you to GENERATE a multi-period plan/schedule for a goal — of ANY kind: learning/study, fitness/training, diet, travel/trip, a project, etc. (e.g. "make a study plan for X by <date>", "a cutting diet to August", "plan a 5-day Kyoto trip") — do NOT generate it inline, do NOT write the tasks, and do NOT emit a goal block.

STEP 1 — clarify essentials IN TEXT first. If the request is missing CONTENT specifics needed to build a genuinely good plan, ask a brief clarifying question (1–3 short questions, or offer a couple of concrete options) and STOP — do NOT emit a \`plan-request\` yet. Examples of essentials worth asking about: a trip with no chosen destination/region, budget, or who's going; a diet with no calorie/goal target or dietary restrictions/allergies; a study plan with no sense of the user's current level or time available; any plan missing the deadline if one clearly matters. If the user explicitly asks YOU to choose (e.g. "you pick the destination"), still confirm the key preferences/constraints, then propose ONE concrete option and ask them to confirm before building. Use what you already remember about the user to avoid re-asking.

STEP 2 — once you have enough, hand off. Reply with ONE short sentence acknowledging it and emit a \`plan-request\` block, then stop:
\`\`\`plan-request
{ "topic": "...", "targetDate": "YYYY-MM-DD", "granularity": "daily" | "weekly" | "monthly", "goalId": "..." }
\`\`\`
The app then shows a small pop-up for the user to choose the cadence and whether to include researched resources/links, and generates+saves the plan as a goal. So do NOT ask about cadence or resources in text (the pop-up covers ONLY those two) — clarify CONTENT, not schedule/resources — and do NOT emit goal/commitment blocks for the plan. Put any decisions you settled (e.g. the chosen destination) into \`topic\` so the generator uses them.
UPDATING an existing plan: if the user asks to CHANGE/redo/refine/regenerate the plan for a goal that is ALREADY in "Your current goals" (e.g. "make the LeetCode plan more concrete", "update each day's tasks"), set \`goalId\` to that goal's EXACT id from the list above and put the desired changes in \`topic\`. The app then REPLACES that goal's tasks in place (same goal, no duplicate). OMIT \`goalId\` for a brand-new plan. When \`goalId\` is set, don't worry about the title — the existing goal keeps its name.
\`granularity\` is your SUGGESTED cadence (the user can change it in the pop-up): a SHORT range (up to ~3 weeks) → "daily"; a MEDIUM range (~3 weeks to ~4 months) → "weekly"; a LONG range (more than ~4 months) → "monthly". A long range should never be daily — that would be hundreds of tasks. \`targetDate\` is optional (omit if the user gave no deadline; then suggest "daily").

1. Save a goal to the user's todo list:
\`\`\`goal
{ "title": "...", "plan": [ { "week": 1, "focus": "..." } ],
  "targetDate": "YYYY-MM-DD",
  "dailyTasks":   [ { "date": "YYYY-MM-DD", "title": "..." } ]
  // OR (never more than one):
  "weeklyTasks":  [ { "weekStart": "YYYY-MM-DD (a Monday)", "title": "..." } ]
  // OR:
  "monthlyTasks": [ { "monthStart": "YYYY-MM-DD (the 1st)", "title": "..." } ] }
\`\`\`
\`plan\`, \`targetDate\`, \`dailyTasks\`, \`weeklyTasks\`, and \`monthlyTasks\` are all optional.
IMPORTANT: do NOT use the task arrays to GENERATE a multi-period plan — that goes through \`plan-request\` (see PLANS above). Use the task arrays ONLY when the user DICTATES specific tasks/dates themselves (e.g. "add a goal to read Atomic Habits with chapter 1 Monday, chapter 2 Tuesday"). In that case include ONLY ONE array:
- \`dailyTasks\` — one entry per day; \`date\` is that day (absolute, resolved against today).
- \`weeklyTasks\` — one entry per week; \`weekStart\` is that week's Monday (weeks run Monday–Sunday).
- \`monthlyTasks\` — one entry per month; \`monthStart\` is the 1st of that month.
Do NOT also emit separate \`commitment\` blocks for these; the tasks belong inside the goal block so they link to the goal and drive its progress.

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
Use an ABSOLUTE date (resolve "tomorrow"/"Friday" against today's date above). "time" and "note" are optional. Use this for standalone one-off reminders NOT tied to a goal. For per-day tasks that belong to a goal, use the goal block's \`dailyTasks\` instead.

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

interface ParsedDailyTask {
  date: string;
  title: string;
}

interface ParsedWeeklyTask {
  weekStart: string;
  title: string;
}

interface ParsedMonthlyTask {
  monthStart: string;
  title: string;
}

interface ParsedGoal {
  title: string;
  plan?: WeeklyPlanItem[];
  targetDate?: string;
  dailyTasks?: ParsedDailyTask[];
  weeklyTasks?: ParsedWeeklyTask[];
  monthlyTasks?: ParsedMonthlyTask[];
}

type PlanGranularity = "daily" | "weekly" | "monthly";

function asGranularity(v: unknown): PlanGranularity | undefined {
  return v === "daily" || v === "weekly" || v === "monthly" ? v : undefined;
}

interface ParsedActions {
  clean: string;
  events: NewEvent[];
  goals: ParsedGoal[];
  memories: { kind: MemoryKind; content: string }[];
  commitments: ParsedCommitment[];
  completeGoals: string[];
  deleteGoals: string[];
  completeCommitments: string[];
  deleteCommitments: string[];
  planRequest?: {
    topic: string;
    targetDate?: string;
    granularity?: PlanGranularity;
    goalId?: string;
  };
}

const BLOCK_RE =
  /```(add-event|goal|remember|commitment|complete-goal|delete-goal|complete-commitment|delete-commitment|plan-request)\s*([\s\S]*?)```/g;

export function parseBlocks(raw: string): ParsedActions {
  const events: NewEvent[] = [];
  const goals: ParsedGoal[] = [];
  const memories: { kind: MemoryKind; content: string }[] = [];
  const commitments: ParsedCommitment[] = [];
  const completeGoals: string[] = [];
  const deleteGoals: string[] = [];
  const completeCommitments: string[] = [];
  const deleteCommitments: string[] = [];
  let planRequest:
    | {
        topic: string;
        targetDate?: string;
        granularity?: PlanGranularity;
        goalId?: string;
      }
    | undefined;

  let match: RegExpExecArray | null;
  while ((match = BLOCK_RE.exec(raw)) !== null) {
    const [, kind, body] = match;
    try {
      const json = JSON.parse(body.trim());
      if (kind === "plan-request" && json.topic)
        planRequest = {
          topic: String(json.topic),
          targetDate:
            typeof json.targetDate === "string" ? json.targetDate : undefined,
          granularity: asGranularity(json.granularity),
          goalId:
            typeof json.goalId === "string" && json.goalId.trim()
              ? json.goalId.trim()
              : undefined,
        };
      else if (kind === "add-event" && json.title && json.date) events.push(json);
      else if (kind === "goal" && json.title)
        goals.push({
          title: json.title,
          plan: json.plan,
          targetDate:
            typeof json.targetDate === "string" ? json.targetDate : undefined,
          dailyTasks: Array.isArray(json.dailyTasks)
            ? json.dailyTasks
            : undefined,
          weeklyTasks: Array.isArray(json.weeklyTasks)
            ? json.weeklyTasks
            : undefined,
          monthlyTasks: Array.isArray(json.monthlyTasks)
            ? json.monthlyTasks
            : undefined,
        });
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
    planRequest,
  };
}

// ---- one chat turn ----

export interface ChatTurnResult {
  reply: string;
  createdGoal: boolean;
  createdEvent: boolean;
  createdCommitment: boolean;
  // Set when the assistant recognized a plan request. The caller opens the
  // plan-options pop-up (cadence + resources); after the user picks, the plan is
  // generated from a layer that survives collapse/unmount (see App.runPlan).
  planRequest?: {
    topic: string;
    targetDate?: string;
    granularity?: PlanGranularity;
    goalId?: string;
  };
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
    const goalId = await saveGoal({
      userId,
      title: g.title,
      plan: g.plan ?? null,
      targetDate: g.targetDate ?? null,
    });
    createdGoal = true;

    // Model-planned tasks linked to this goal — daily, weekly, OR monthly; only
    // one array is ever populated.
    const weekly = (g.weeklyTasks ?? []).filter(
      (t) => t && /^\d{4}-\d{2}-\d{2}$/.test(t.weekStart) && t.title
    );
    const monthly = (g.monthlyTasks ?? []).filter(
      (t) => t && /^\d{4}-\d{2}-\d{2}$/.test(t.monthStart) && t.title
    );
    const daily = (g.dailyTasks ?? []).filter(
      (t) => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.title
    );

    if (weekly.length > 0) {
      await setGoalGranularity(goalId, "weekly");
      for (const t of weekly) {
        await createCommitment({
          userId,
          title: t.title,
          date: t.weekStart,
          time: null,
          source: "goal",
          goalId,
          span: "week",
        });
      }
      await setGoalTaskTotal(goalId, weekly.length);
      createdCommitment = true;
    } else if (monthly.length > 0) {
      await setGoalGranularity(goalId, "monthly");
      for (const t of monthly) {
        await createCommitment({
          userId,
          title: t.title,
          date: t.monthStart,
          time: null,
          source: "goal",
          goalId,
          span: "month",
        });
      }
      await setGoalTaskTotal(goalId, monthly.length);
      createdCommitment = true;
    } else if (daily.length > 0) {
      await setGoalGranularity(goalId, "daily");
      for (const t of daily) {
        await createCommitment({
          userId,
          title: t.title,
          date: t.date,
          time: null,
          source: "goal",
          goalId,
          span: null,
        });
      }
      await setGoalTaskTotal(goalId, daily.length);
      createdCommitment = true;
    }
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
  ctx: { events: CalendarEvent[]; emails: PendingEmail[]; teams: TeamsMessage[] }
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
    ctx.teams,
    memories,
    goals,
    commitments
  );
  const { adapter, config } = await getActiveAdapter();
  const { text: raw } = await adapter.complete(
    { system, messages: history, maxTokens: 1024 },
    config
  );
  const parsed = parseBlocks(raw);

  const { createdGoal, createdEvent, createdCommitment } = await applyActions(
    userId,
    parsed
  );

  const visible = parsed.clean || "Done.";
  await addMessage(userId, "assistant", visible);

  // A plan request: signal the caller to open the plan-options pop-up. (Nothing
  // is generated yet — the user picks cadence + resources first.)
  if (parsed.planRequest) {
    console.log("[plan-debug] plan-request → open options modal", parsed.planRequest);
    return {
      reply: visible,
      createdGoal,
      createdEvent,
      createdCommitment,
      planRequest: parsed.planRequest,
    };
  }

  return { reply: visible, createdGoal, createdEvent, createdCommitment };
}
