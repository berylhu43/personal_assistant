import { execute, uid } from "./db";
import { createGoal, setGoalGranularity, setGoalTaskTotal, listGoals } from "./goals";
import { createCommitment, setCommitmentDone } from "./localCalendar";
import { createPlan } from "./plans";
import { addMemory } from "./memory";
import { setCachedInbox } from "./emailTasks";
import { listProviders, setProviderKey, setActiveProvider } from "./providers";
import type { PlanDay, InboxTaskCandidate } from "./types";

// Demo mode: run the app against a SEPARATE database (assistant-demo.db, see
// db.ts) pre-filled with realistic sample data, and skip Google sign-in (App.tsx)
// so the whole UI can be shown offline. Toggle with VITE_DEMO=1 at build/dev
// time. Your real assistant.db is never touched.
export const IS_DEMO =
  import.meta.env.VITE_DEMO === "1" || import.meta.env.VITE_DEMO === "true";

/** Local YYYY-MM-DD, `offset` days from today. */
function dayStr(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** The Monday of the week `weekOffset` weeks from now (weeks run Mon–Sun). */
function mondayStr(weekOffset = 0): string {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun … 6=Sat
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow) + weekOffset * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** The 1st of the month `monthOffset` months from now. */
function monthStartStr(monthOffset = 0): string {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// In-flight guard: React StrictMode double-invokes the boot effect in dev, so
// seedDemoData can be called twice concurrently. Memoizing the promise makes the
// two calls share ONE run — otherwise both read an empty DB before either writes
// and each seeds a full copy (duplicated goals/plans).
let seedPromise: Promise<void> | null = null;

/**
 * Populate the demo database with a realistic showcase — exactly once. Concurrent
 * callers share one run (see above); later runs skip because a goal already
 * exists. Uses the real CRUD paths so the data behaves like user-created data
 * (progress recompute, plan docs, etc.).
 */
export function seedDemoData(userId: string): Promise<void> {
  if (!seedPromise) seedPromise = doSeed(userId);
  return seedPromise;
}

/**
 * Optional convenience: if VITE_DEMO_KEY is set, pre-fill that provider's key in
 * the demo DB and make it active — so you can chat / build plans in the demo
 * without opening Settings. (Provider keys are per-DB, so the demo starts with
 * none.) Provider defaults to Anthropic; override with VITE_DEMO_PROVIDER.
 * No key set → you just paste one in Settings once, then pick the model.
 */
async function provisionDemoKey(): Promise<void> {
  const key = import.meta.env.VITE_DEMO_KEY as string | undefined;
  if (!key) return;
  const providerId = (import.meta.env.VITE_DEMO_PROVIDER as string) || "anthropic";
  const providers = await listProviders().catch(() => []);
  const target = providers.find((p) => p.id === providerId);
  // Skip if unknown id or it already has a key (don't clobber a manual change).
  if (!target || target.api_key) return;
  await setProviderKey(providerId, key.trim());
  await setActiveProvider(providerId);
}

async function doSeed(userId: string): Promise<void> {
  await provisionDemoKey().catch((e) => console.error("[demo] key provision failed:", e));

  const existing = await listGoals(userId).catch(() => []);
  if (existing.length > 0) return; // already seeded

  // ---- Goal A: researched WEEKLY plan (rich plan document with links) ----
  const aId = await createGoal({
    userId,
    title: "Learn AI agents",
    startDate: mondayStr(0),
    targetDate: mondayStr(3),
    note: "Focus on tool use + orchestration. Ship one small agent by the end.",
  });
  await setGoalGranularity(aId, "weekly");
  const aDays: PlanDay[] = [
    {
      date: mondayStr(0),
      topic: "Agent fundamentals",
      task: "Core concepts + a toy ReAct loop",
      practice: "Build a 1-tool agent",
      est_time: "5h",
      resources: [
        {
          kind: "doc",
          title: "Anthropic — Building effective agents",
          url: "https://www.anthropic.com/research/building-effective-agents",
        },
        {
          kind: "repo",
          title: "anthropics/anthropic-cookbook",
          url: "https://github.com/anthropics/anthropic-cookbook",
        },
      ],
    },
    {
      date: mondayStr(1),
      topic: "Tool use & function calling",
      task: "Define tools; handle multi-step calls",
      practice: "Add 3 tools to the agent",
      est_time: "5h",
      resources: [
        {
          kind: "doc",
          title: "Tool use (function calling) guide",
          url: "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
        },
      ],
    },
    {
      date: mondayStr(2),
      topic: "Memory & retrieval",
      task: "Add short + long-term memory",
      practice: "Wire a vector store",
      est_time: "6h",
      resources: [
        {
          kind: "article",
          title: "Model Context Protocol (MCP)",
          url: "https://modelcontextprotocol.io/introduction",
        },
      ],
    },
    {
      date: mondayStr(3),
      topic: "Ship & evaluate",
      task: "Package the agent; write evals",
      practice: "Run 10 eval cases",
      est_time: "6h",
      resources: [],
    },
  ];
  const aWeekIds: string[] = [];
  for (const d of aDays) {
    const id = await createCommitment({
      userId,
      title: d.topic,
      date: d.date,
      source: "goal",
      goalId: aId,
      span: "week",
    });
    aWeekIds.push(id);
  }
  await setGoalTaskTotal(aId, aDays.length);
  await createPlan({ goalId: aId, title: "Learn AI agents", content: JSON.stringify(aDays) });
  await setCommitmentDone(aWeekIds[0], true); // week 1 done → ~25%

  // ---- Goal B: manual DAILY tasks (schedule-only, notes, partial progress) ----
  const bId = await createGoal({
    userId,
    title: "Read Designing Data-Intensive Applications",
    targetDate: dayStr(10),
    note: "One chapter every couple of days. Take notes on trade-offs.",
  });
  await setGoalGranularity(bId, "daily");
  const bTasks = [
    { off: -2, title: "Ch.1 — Reliable, scalable, maintainable", done: true },
    { off: -1, title: "Ch.2 — Data models & query languages", done: true },
    { off: 0, title: "Ch.3 — Storage and retrieval", done: false },
    { off: 2, title: "Ch.4 — Encoding and evolution", done: false },
    { off: 4, title: "Ch.5 — Replication", done: false },
  ];
  for (const t of bTasks) {
    const id = await createCommitment({
      userId,
      title: t.title,
      date: dayStr(t.off),
      source: "goal",
      goalId: bId,
      note: "Summarize the key trade-off in 2 lines.",
    });
    if (t.done) await setCommitmentDone(id, true);
  }
  await setGoalTaskTotal(bId, bTasks.length); // 2/5 done → 40%

  // ---- Goal C: MONTHLY plan (span=month, lightweight, 0%) ----
  const cId = await createGoal({
    userId,
    title: "Train for a 10K",
    startDate: monthStartStr(0),
    targetDate: monthStartStr(2),
    note: "Build a base, then add speed. Rest is part of the plan.",
  });
  await setGoalGranularity(cId, "monthly");
  const cMonths = [
    { off: 0, title: "Base building — easy miles", note: "3 runs/week, all conversational pace." },
    { off: 1, title: "Add tempo + long run", note: "Introduce 1 tempo + a weekly long run." },
    { off: 2, title: "Sharpen & race", note: "Intervals, taper, then race day." },
  ];
  for (const m of cMonths) {
    await createCommitment({
      userId,
      title: m.title,
      date: monthStartStr(m.off),
      source: "goal",
      goalId: cId,
      span: "month",
      note: m.note,
    });
  }
  await setGoalTaskTotal(cId, cMonths.length);

  // ---- Standalone local-calendar commitments ----
  await createCommitment({
    userId,
    title: "Dentist appointment",
    date: dayStr(0),
    time: "14:00",
    source: "manual",
    note: "Dr. Lee — 5th & Pine. Bring insurance card.",
  });
  await createCommitment({
    userId,
    title: "Call the plumber about the leak",
    date: dayStr(1),
    source: "chat",
  });
  await createCommitment({
    userId,
    title: "Flight to SFO — UA 123 6:40am",
    date: dayStr(3),
    time: "06:40",
    source: "email",
    note: "Confirmation KX9QP2. Check in 24h before.",
  });
  await createCommitment({
    userId,
    title: "Submit Q2 expense report",
    date: dayStr(4),
    source: "manual",
  });

  // ---- Long-term memory ----
  await addMemory({ userId, kind: "preference", content: "Prefers morning deep-work blocks (before noon)." });
  await addMemory({ userId, kind: "fact", content: "Is learning to build AI agents." });
  await addMemory({ userId, kind: "preference", content: "Allergic to peanuts." });

  // ---- Today's briefing (so the panel shows immediately, no model call) ----
  await execute(
    `INSERT INTO briefings (id, user_id, date, summary, notes)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id, date) DO UPDATE SET summary = excluded.summary, notes = excluded.notes`,
    [
      uid(),
      userId,
      dayStr(0),
      "Light day — one appointment and a reading task. Your flight is in 3 days, so check in tonight.",
      JSON.stringify([
        "Dentist at 2:00pm — leave by 1:40",
        "Flight to SFO in 3 days — online check-in opens tonight",
        "Expense report due in 4 days",
        "AI agents: week 1 done — start tool use",
      ]),
    ]
  );

  // ---- Inbox candidates (cached so it renders offline, no Gmail/LLM) ----
  const inbox: InboxTaskCandidate[] = [
    {
      source: "email",
      sourceId: "demo-email-1",
      from: "Sam Rivera",
      subject: "Q3 numbers?",
      task: { title: "Reply to Sam with the Q3 numbers", date: dayStr(1), kind: "commitment" },
    },
    {
      source: "email",
      sourceId: "demo-email-2",
      from: "Marriott Rewards",
      subject: "Your upcoming stay",
      task: { title: "Hotel check-in: Marriott Seattle", date: dayStr(3), kind: "commitment" },
    },
  ];
  await setCachedInbox(userId, inbox);
}
