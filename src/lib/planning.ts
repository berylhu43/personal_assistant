import { chat } from "./anthropic";
import { openaiCompatAdapter, getActiveAdapter, type ProviderConfig } from "./llm";
import { researchWithSearch } from "./gptSearch";
import { getActiveProvider } from "./providers";
import {
  saveGoal,
  setGoalGranularity,
  setGoalTaskTotal,
  getGoalById,
  updateGoal,
} from "./goals";
import { createCommitment, deleteTasksByGoal } from "./localCalendar";
import { createPlan, deletePlansByGoal } from "./plans";
import type { PendingPlan } from "./store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Hard ceilings so the plan path can NEVER hang silently. Web search runs
// several server-side searches plus a long structured output, so it genuinely
// needs minutes — give it real headroom before falling back to the search-free
// path. Generation runs at App level (survives collapse), so a long wait is
// fine; the indicator stays visible the whole time.
const SEARCH_TIMEOUT_MS = 210_000; // 3.5 min
const NOSEARCH_TIMEOUT_MS = 90_000;

// A multi-period plan with resources easily exceeds 4096 output tokens; too
// small a budget truncates the JSON mid-array and parsing fails.
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

// ---- cadence ----
// The plan can be scheduled daily / weekly / monthly, or at a "custom" rhythm
// the user typed (resolved to explicit dated tasks). Each "days" entry is one
// period; its "date" is that period's start.
type Granularity = "daily" | "weekly" | "monthly" | "custom";

interface Cadence {
  span: "week" | "month" | null;
  phrase: string; // "day-by-day"
  spread: string; // how to spread entries across the range
  dateDesc: string; // what each entry's "date" means
  label: string; // word for the saved-confirmation reply
  storeGranularity: "daily" | "weekly" | "monthly"; // goal.granularity column
}

function cadenceInfo(g: Granularity, custom?: string): Cadence {
  switch (g) {
    case "weekly":
      return {
        span: "week",
        phrase: "week-by-week",
        spread: "one entry per week (weeks run Monday–Sunday)",
        dateDesc: "that week's Monday (YYYY-MM-DD)",
        label: "weekly",
        storeGranularity: "weekly",
      };
    case "monthly":
      return {
        span: "month",
        phrase: "month-by-month",
        spread: "one entry per month",
        dateDesc: "the 1st of that month (YYYY-MM-DD)",
        label: "monthly",
        storeGranularity: "monthly",
      };
    case "custom":
      return {
        span: null,
        phrase: "custom-cadence",
        spread: `entries spaced at this rhythm: "${
          custom?.trim() || "as appropriate"
        }" — choose explicit dates that fit it`,
        dateDesc: "that task's date (YYYY-MM-DD)",
        label: "scheduled",
        storeGranularity: "daily",
      };
    case "daily":
    default:
      return {
        span: null,
        phrase: "day-by-day",
        spread: "one entry per day",
        dateDesc: "that day (YYYY-MM-DD)",
        label: "daily",
        storeGranularity: "daily",
      };
  }
}

// ---- prompts ----

// Heavy (researched) plan: domain-general, grounded in real web resources.
function buildPlanSystem(c: Cadence): string {
  return `You build a concrete, ${c.phrase} plan for the user's goal — which may be learning/study, fitness or training, diet, travel, a project, or anything else — and ground it in REAL, current resources you find via web search.

Process:
- Search the web for currently-existing, high-quality resources relevant to the goal (official docs, articles, guides, videos, repos, recipes, places — whatever fits). Use REAL URLs taken from the search results — never invent or guess links.
- Spread the work across the requested date range as ${c.spread}, resolving every date to an absolute YYYY-MM-DD. Each entry's "date" is ${c.dateDesc}.

Return ONLY a single JSON object (no prose before or after) of this exact shape:
{
  "goal": { "title": "...", "targetDate": "YYYY-MM-DD" },
  "days": [
    {
      "date": "YYYY-MM-DD",
      "topic": "short label for this period (e.g. \\"Core lifts\\", \\"Kyoto temples\\", \\"MCP basics\\")",
      "task": "short what-to-do (<= ~60 chars)",
      "practice": "optional: a concrete hands-on step (<= ~60 chars)",
      "resources": [ { "kind": "doc|article|video|guide|repo|recipe|place|...", "title": "...", "url": "..." } ],
      "est_time": "optional, e.g. 2h"
    }
  ]
}

Each entry in "days" represents ONE period. Keep "task" and "practice" SHORT (<= ~60 chars). Put detail and links in "resources".
Keep the plan COMPACT so the whole JSON fits in one response: at most 2 resources per entry, concise titles. Cover the full range without padding — at most ~30 entries.
Return ONLY the raw JSON object — no markdown code fences, no prose before or after.`;
}

function buildPlanSystemNoSearch(c: Cadence): string {
  return `${buildPlanSystem(c)}

NOTE: Web search is unavailable for this request. Build the plan from your own knowledge. Only include resource URLs you are highly confident exist (official docs, well-known sites); otherwise omit the "resources" array for that entry. Never invent links.`;
}

// GPT goes through the Responses API with a single combined prompt (no separate
// system field). Cap the number of searches in-prompt to bound cost + latency.
function buildPlanSystemGptSearch(c: Cadence): string {
  return `${buildPlanSystem(c)}

Search the web AT MOST 3 times — be efficient, then write the plan.`;
}

// Lightweight (no resources): just a schedule with an optional one-line detail.
// No web search, so it works with ANY provider.
function buildLightSystem(c: Cadence): string {
  return `You lay out a concrete, ${c.phrase} schedule for the user's goal (learning, fitness, diet, travel, a project, anything). Use your own knowledge — do NOT include links or resources.

Spread the work across the requested date range as ${c.spread}, resolving every date to an absolute YYYY-MM-DD. Each entry's "date" is ${c.dateDesc}.

Return ONLY a single JSON object (no prose) of this exact shape:
{
  "goal": { "title": "...", "targetDate": "YYYY-MM-DD" },
  "days": [
    { "date": "YYYY-MM-DD", "title": "short task for this period (<= ~70 chars)", "detail": "optional ONE line of guidance (<= ~120 chars)" }
  ]
}

One entry per period. Cover the full range without padding — at most ~40 entries. No links, no resources.
Return ONLY the raw JSON object — no markdown code fences, no prose.`;
}

export interface PlanResult {
  ok: boolean;
  reply: string;
  goalId?: string;
  title?: string;
}

function buildUserMsg(req: PendingPlan, c: Cadence): string {
  return `Today's date is ${todayStr()}.

Build a ${c.phrase} plan.
Goal/topic: ${req.topic}
Target date: ${req.targetDate ?? "(pick a sensible span, ~2–4 weeks from today)"}
Schedule: ${c.spread}.

Return ONLY the JSON object.`;
}

// Unified intermediate produced by either provider branch: the draft plan text
// (the JSON, which already embeds the real resource links the model found) plus
// the list of verified source links, and whether live search actually ran.
interface PlanDraft {
  text: string;
  sources: { url: string; title: string }[];
  usedSearch: boolean;
}

/**
 * Claude branch: native web_search, with a no-search fallback. Claude embeds the
 * real links it found directly in the JSON `resources`, so there is no separate
 * citation list to surface here.
 */
async function fetchPlanDraftClaude(userMsg: string, c: Cadence): Promise<PlanDraft> {
  try {
    console.log("[plan-debug] Claude chat(webSearch=true)…");
    const text = await withTimeout(
      chat([{ role: "user", content: userMsg }], buildPlanSystem(c), PLAN_MAX_TOKENS, {
        webSearch: true,
      }),
      SEARCH_TIMEOUT_MS,
      "web-search plan request"
    );
    return { text, sources: [], usedSearch: true };
  } catch (e) {
    console.error("[plan-debug] Claude web-search failed — no-search fallback:", e);
    const text = await withTimeout(
      chat(
        [{ role: "user", content: userMsg }],
        buildPlanSystemNoSearch(c),
        PLAN_MAX_TOKENS
      ),
      NOSEARCH_TIMEOUT_MS,
      "plan request"
    );
    return { text, sources: [], usedSearch: false };
  }
}

/**
 * GPT branch: OpenAI Responses API web_search (returns real url_citations), with
 * a no-search Chat Completions fallback.
 */
async function fetchPlanDraftGpt(
  userMsg: string,
  cfg: ProviderConfig,
  c: Cadence
): Promise<PlanDraft> {
  try {
    console.log("[plan-debug] GPT Responses web_search…");
    const r = await withTimeout(
      researchWithSearch(`${buildPlanSystemGptSearch(c)}\n\n${userMsg}`, cfg),
      SEARCH_TIMEOUT_MS,
      "web-search plan request"
    );
    return { text: r.text, sources: r.sources, usedSearch: true };
  } catch (e) {
    console.error("[plan-debug] GPT web-search failed — no-search fallback:", e);
    const r = await withTimeout(
      openaiCompatAdapter.complete(
        {
          system: buildPlanSystemNoSearch(c),
          messages: [{ role: "user", content: userMsg }],
          maxTokens: PLAN_MAX_TOKENS,
        },
        cfg
      ),
      NOSEARCH_TIMEOUT_MS,
      "plan request"
    );
    return { text: r.text, sources: [], usedSearch: false };
  }
}

/** Lightweight branch: no search, any provider, via the active adapter. */
async function fetchLightPlan(userMsg: string, c: Cadence): Promise<string> {
  console.log("[plan-debug] lightweight plan (no search)…");
  const { adapter, config } = await getActiveAdapter();
  const { text } = await withTimeout(
    adapter.complete(
      {
        system: buildLightSystem(c),
        messages: [{ role: "user", content: userMsg }],
        maxTokens: PLAN_MAX_TOKENS,
      },
      config
    ),
    NOSEARCH_TIMEOUT_MS,
    "plan request"
  );
  return text;
}

/**
 * Generate a plan for any goal and persist it as a GOAL (so it survives closing
 * the chat): a `goals` row + one commitment per period (span set by cadence).
 *
 * Two modes, chosen by `req.withResources` from the plan-options pop-up:
 * - WITH resources → web-search a domain-general, researched plan (rich
 *   `PlanDay` entries + a stored plan document with real links). Needs a
 *   search-capable provider (Claude/GPT).
 * - WITHOUT resources → a no-search, schedule-only plan (title + optional
 *   one-line detail per period, stored on each commitment's note). Any provider.
 *
 * Resilient: timeouts + a no-search fallback for the heavy path; honest failure
 * if everything fails or the JSON can't be parsed.
 */
export async function generatePlan(
  userId: string,
  req: PendingPlan
): Promise<PlanResult> {
  console.log("[plan-debug] generatePlan start", req);

  const provider = await getActiveProvider();
  if (!provider || !provider.api_key) {
    return {
      ok: false,
      reply: "Add your model's API key in Settings to build plans.",
    };
  }

  const withResources = req.withResources ?? true;
  const granularity: Granularity = req.granularity ?? "daily";
  const c = cadenceInfo(granularity, req.customCadence);
  const userMsg = buildUserMsg(req, c);

  // ---- Fetch the draft (the ONLY mode/provider-specific part) ----
  let raw: string;
  let usedSearch = false;
  try {
    if (withResources) {
      if (provider.supports_web_search !== 1) {
        // DeepSeek / Qwen can't web-search — point the user at the no-resources
        // option (which works on any provider) or a search-capable provider.
        return {
          ok: false,
          reply:
            "Researched resources need web search — switch to Claude or GPT in Settings, or ask again and choose “no resources” for a schedule-only plan.",
        };
      }
      const gptCfg: ProviderConfig | null =
        provider.id === "openai"
          ? {
              id: provider.id,
              apiFormat: "openai_compatible",
              baseUrl: provider.base_url,
              model: provider.default_model,
              apiKey: provider.api_key as string,
            }
          : null;
      const draft = gptCfg
        ? await fetchPlanDraftGpt(userMsg, gptCfg, c)
        : await fetchPlanDraftClaude(userMsg, c);
      raw = draft.text;
      usedSearch = draft.usedSearch;
    } else {
      raw = await fetchLightPlan(userMsg, c);
    }
  } catch (e2) {
    console.error("[plan-debug] plan generation failed:", e2);
    return {
      ok: false,
      reply: `I couldn't build the plan — ${
        (e2 as Error)?.message ?? "the request failed"
      }. Please try again in a moment.`,
    };
  }

  // ---- Parse + validate (shared) ----
  let parsed: any;
  try {
    parsed = parsePlanJson(raw);
    console.log("[plan-debug] parsed ok; days =", parsed?.days?.length);
  } catch {
    console.error("[plan-debug] JSON parse failed; raw head:", raw.slice(0, 200));
    return {
      ok: false,
      reply:
        "I couldn't finish building that plan — the response didn't come back complete. Try a shorter range or a narrower goal.",
    };
  }

  const goal = parsed?.goal;
  const days = parsed?.days;
  if (!goal?.title || !Array.isArray(days) || days.length === 0) {
    console.error("[plan-debug] invalid plan shape", { hasGoal: !!goal, days });
    return {
      ok: false,
      reply:
        "I couldn't build a usable plan. Try narrowing the goal or giving a clearer target date.",
    };
  }

  const targetDate =
    typeof goal.targetDate === "string" && DATE_RE.test(goal.targetDate)
      ? goal.targetDate
      : req.targetDate && DATE_RE.test(req.targetDate)
        ? req.targetDate
        : null;

  // ---- Persist: goal + per-period commitments (+ plan doc when researched) ----
  // If the user asked to UPDATE an existing goal's plan, regenerate in place:
  // keep the same goal (and its title), wipe its old plan tasks + document, and
  // rebuild below. Otherwise create/upsert a goal by title as usual.
  const existing = req.goalId ? await getGoalById(req.goalId) : null;
  const updating = !!existing;
  const title = existing ? existing.title : String(goal.title);

  let goalId: string;
  if (existing) {
    goalId = existing.id;
    console.log("[plan-debug] regenerating plan for goal", goalId, title);
    await deleteTasksByGoal(goalId);
    await deletePlansByGoal(goalId);
    // Refresh the target date if the model/request settled a new one; keep the
    // existing title (the user asked to update tasks, not rename the goal).
    if (targetDate) await updateGoal(goalId, { targetDate });
  } else {
    console.log("[plan-debug] saveGoal…", title, targetDate);
    goalId = await saveGoal({ userId, title, targetDate });
  }
  await setGoalGranularity(goalId, c.storeGranularity);

  let count = 0;
  for (const d of days) {
    if (!d || typeof d.date !== "string" || !DATE_RE.test(d.date)) continue;
    const taskTitle = String(d.title || d.topic || d.task || "Task").slice(0, 120);
    // Lightweight plans carry their one-line guidance on the commitment note;
    // researched plans keep their detail in the plan document instead.
    const note =
      !withResources && typeof d.detail === "string" && d.detail.trim()
        ? d.detail.trim()
        : null;
    await createCommitment({
      userId,
      title: taskTitle,
      date: d.date,
      time: null,
      source: "goal",
      goalId,
      span: c.span,
      note,
    });
    count++;
  }
  console.log("[plan-debug] commitments created", count);
  await setGoalTaskTotal(goalId, count);

  if (withResources) {
    await createPlan({ goalId, title, content: JSON.stringify(days) });
    console.log("[plan-debug] plan document saved");
  }

  const base = `${updating ? "Updated" : "Saved"} your ${title} plan — ${count} ${
    c.label
  } task${count === 1 ? "" : "s"}`;
  const reply = withResources
    ? usedSearch
      ? `${base} with resources and links.`
      : `${base} (built from prior knowledge — web search was unavailable, so links may be limited).`
    : `${base}.`;

  return { ok: true, goalId, title, reply };
}
