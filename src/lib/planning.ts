import { chat } from "./anthropic";
import { saveGoal, setGoalGranularity, setGoalTaskTotal } from "./goals";
import { createCommitment } from "./localCalendar";
import { createPlan } from "./plans";
import type { PendingPlan } from "./store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Hard ceilings so the plan path can NEVER hang silently. Web search runs
// several server-side searches plus a long structured output, so it genuinely
// needs minutes — give it real headroom before falling back to the search-free
// path. Generation now runs at App level (survives collapse), so a long wait is
// fine; the indicator stays visible the whole time.
const SEARCH_TIMEOUT_MS = 210_000; // 3.5 min
const NOSEARCH_TIMEOUT_MS = 90_000;

// A multi-week day-by-day plan with resources easily exceeds 4096 output
// tokens; too small a budget truncates the JSON mid-array and parsing fails.
const PLAN_MAX_TOKENS = 8192;

/**
 * Extract the plan object from model output. The model often wraps its JSON in
 * a ```json … ``` markdown fence, so strip fences first, then match the
 * outermost object (same approach as distill.ts / briefing.ts). Throws if the
 * result isn't valid JSON.
 */
function parsePlanJson(raw: string): any {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : cleaned);
}

/** Reject after `ms` so a stalled request can't block forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/** Local date as YYYY-MM-DD. */
function todayStr(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

const PLAN_SYSTEM = `You build a concrete, day-by-day learning plan and ground it in REAL resources you find via web search.

Process:
- Search the web for currently-existing, high-quality resources (GitHub repos, official docs, articles, code) for the requested topics. Use REAL URLs taken from the search results — never invent or guess links.
- Spread the work across the requested date range, resolving every date to an absolute YYYY-MM-DD.

Return ONLY a single JSON object (no prose before or after) of this exact shape:
{
  "goal": { "title": "...", "targetDate": "YYYY-MM-DD", "granularity": "daily" },
  "days": [
    {
      "date": "YYYY-MM-DD",
      "topic": "short topic, e.g. MCP fundamentals",
      "task": "short what-to-do (<= ~60 chars)",
      "practice": "short hands-on thing (<= ~60 chars)",
      "resources": [ { "kind": "repo|article|doc|code", "title": "...", "url": "..." } ],
      "est_time": "2h"
    }
  ]
}

Keep "task" and "practice" SHORT (<= ~60 chars). Put detail and links in "resources". One entry per day.
Keep the plan COMPACT so the whole JSON fits in one response: at most 2 resources per day, concise titles. If the date range is long, cover it without padding.
Return ONLY the raw JSON object — no markdown code fences, no prose before or after.`;

const PLAN_SYSTEM_NOSEARCH = `${PLAN_SYSTEM}

NOTE: Web search is unavailable for this request. Build the plan from your own knowledge. Only include resource URLs you are highly confident exist (official docs, well-known repos); otherwise omit the "resources" array for that day. Never invent links.`;

export interface PlanResult {
  ok: boolean;
  reply: string;
  goalId?: string;
  title?: string;
}

function buildUserMsg(req: PendingPlan): string {
  return `Today's date is ${todayStr()}.

Build a day-by-day learning plan.
Topic: ${req.topic}
Target date: ${req.targetDate ?? "(pick a sensible span, ~2–4 weeks from today)"}

Return ONLY the JSON object.`;
}

/**
 * The dedicated plan path: web-search the topic, generate a fixed structure,
 * persist a goal + daily commitments + the full plan document. Resilient by
 * design — if web search fails or stalls, it falls back to a search-free plan
 * (goal + daily tasks, fewer/no resource links) rather than hanging. Reports
 * honest failure if everything fails or the JSON can't be parsed.
 */
export async function generatePlan(
  userId: string,
  req: PendingPlan
): Promise<PlanResult> {
  console.log("[plan-debug] generatePlan start", req);
  const userMsg = buildUserMsg(req);

  let raw: string;
  let usedSearch = true;

  try {
    console.log("[plan-debug] calling chat(webSearch=true, 4096)…");
    raw = await withTimeout(
      chat([{ role: "user", content: userMsg }], PLAN_SYSTEM, PLAN_MAX_TOKENS, {
        webSearch: true,
      }),
      SEARCH_TIMEOUT_MS,
      "web-search plan request"
    );
    console.log("[plan-debug] web-search chat returned, length", raw.length);
  } catch (e) {
    console.error(
      "[plan-debug] web-search path failed — falling back to no-search:",
      e
    );
    usedSearch = false;
    try {
      console.log("[plan-debug] calling chat(no search, 4096)…");
      raw = await withTimeout(
        chat(
          [{ role: "user", content: userMsg }],
          PLAN_SYSTEM_NOSEARCH,
          PLAN_MAX_TOKENS
        ),
        NOSEARCH_TIMEOUT_MS,
        "plan request"
      );
      console.log("[plan-debug] no-search chat returned, length", raw.length);
    } catch (e2) {
      console.error("[plan-debug] no-search path also failed:", e2);
      return {
        ok: false,
        reply: `I couldn't build the plan — ${
          (e2 as Error)?.message ?? "the request failed"
        }. Please try again in a moment.`,
      };
    }
  }

  let parsed: any;
  try {
    console.log("[plan-debug] parsing JSON…");
    parsed = parsePlanJson(raw);
    console.log("[plan-debug] parsed ok; days =", parsed?.days?.length);
  } catch {
    console.error("[plan-debug] JSON parse failed; raw head:", raw.slice(0, 200));
    return {
      ok: false,
      reply:
        "I couldn't finish building that plan — the response didn't come back complete. Try a shorter date range or a narrower topic.",
    };
  }

  const goal = parsed?.goal;
  const days = parsed?.days;
  if (!goal?.title || !Array.isArray(days) || days.length === 0) {
    console.error("[plan-debug] invalid plan shape", { hasGoal: !!goal, days });
    return {
      ok: false,
      reply:
        "I couldn't build a usable plan from what I found. Try narrowing the topic or giving a clearer target date.",
    };
  }

  const targetDate =
    typeof goal.targetDate === "string" && DATE_RE.test(goal.targetDate)
      ? goal.targetDate
      : req.targetDate && DATE_RE.test(req.targetDate)
        ? req.targetDate
        : null;

  console.log("[plan-debug] saveGoal…", goal.title, targetDate);
  const goalId = await saveGoal({ userId, title: String(goal.title), targetDate });
  await setGoalGranularity(goalId, "daily");
  console.log("[plan-debug] goal saved", goalId);

  let count = 0;
  for (const d of days) {
    if (!d || typeof d.date !== "string" || !DATE_RE.test(d.date)) continue;
    const title = String(d.topic || d.task || "Study").slice(0, 120);
    await createCommitment({
      userId,
      title,
      date: d.date,
      time: null,
      source: "goal",
      goalId,
    });
    count++;
  }
  console.log("[plan-debug] commitments created", count);
  await setGoalTaskTotal(goalId, count);

  await createPlan({
    goalId,
    title: String(goal.title),
    content: JSON.stringify(days),
  });
  console.log("[plan-debug] plan document saved");

  return {
    ok: true,
    goalId,
    title: String(goal.title),
    reply: usedSearch
      ? `Saved a ${count}-day ${goal.title} plan with daily tasks and resources.`
      : `Saved a ${count}-day ${goal.title} plan with daily tasks (built from prior knowledge — web search was unavailable, so resource links may be limited).`,
  };
}
