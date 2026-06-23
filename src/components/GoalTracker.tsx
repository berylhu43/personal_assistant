import { useCallback, useEffect, useState } from "react";
import {
  listGoals,
  createGoal,
  setGoalProgress,
  setGoalDone,
  deleteGoal,
} from "../lib/goals";
import { getPlanByGoal } from "../lib/plans";
import { openExternal } from "../lib/openExternal";
import type { Goal, PlanDay } from "../lib/types";

/** A goal has expandable detail if it carries a weekly plan or linked tasks. */
function hasDetails(g: Goal): boolean {
  return (g.plan != null && g.plan.length > 0) || g.taskTotal > 0;
}

/** "2026-07-01" → "Jul 1". */
function formatTarget(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function GoalTracker({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState("");
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  // Cache of loaded plan documents (learning-plan goals) by goal id.
  const [planDocs, setPlanDocs] = useState<Record<string, PlanDay[]>>({});

  // Toggle a goal's detail, lazily loading its saved plan document if any.
  async function toggleOpen(goal: Goal) {
    const willOpen = openPlan !== goal.id;
    setOpenPlan(willOpen ? goal.id : null);
    if (willOpen && planDocs[goal.id] === undefined && goal.taskTotal > 0) {
      try {
        const row = await getPlanByGoal(goal.id);
        const days = row ? (JSON.parse(row.content) as PlanDay[]) : [];
        setPlanDocs((m) => ({ ...m, [goal.id]: Array.isArray(days) ? days : [] }));
      } catch {
        setPlanDocs((m) => ({ ...m, [goal.id]: [] }));
      }
    }
  }

  const refresh = useCallback(() => {
    listGoals(userId).then(setGoals).catch(() => setGoals([]));
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await createGoal({ userId, title: t });
    refresh();
  }

  async function toggle(g: Goal) {
    await setGoalDone(g.id, !g.done);
    refresh();
  }

  async function progress(g: Goal, value: number) {
    // Optimistic update for a snappy slider.
    setGoals((prev) =>
      prev.map((x) => (x.id === g.id ? { ...x, progress: value } : x))
    );
    await setGoalProgress(g.id, value);
  }

  async function remove(id: string) {
    await deleteGoal(id);
    refresh();
  }

  return (
    <div>
      <ul className="space-y-3.5">
        {goals.map((goal) => (
          <li key={goal.id} className="group">
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggle(goal)}
                aria-label={goal.done ? "Mark not done" : "Mark done"}
                className={`h-[18px] w-[18px] shrink-0 rounded-[6px] border transition ${
                  goal.done
                    ? "border-done bg-done"
                    : "border-ink/25 hover:border-gold"
                }`}
              />
              <span
                onClick={() => {
                  if (hasDetails(goal)) void toggleOpen(goal);
                }}
                title={hasDetails(goal) ? "Click to view the plan" : undefined}
                className={`flex-1 truncate font-sans text-sm ${
                  goal.done ? "text-ink/40 line-through" : "text-ink"
                } ${hasDetails(goal) ? "cursor-pointer hover:text-gold-deep" : ""}`}
              >
                {goal.title}
              </span>
              {goal.plan && goal.plan.length > 0 && (
                <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-gold-deep">
                  {goal.plan.length}wk
                </span>
              )}
              {goal.targetDate && (
                <span className="shrink-0 font-mono text-[10px] text-ink/40">
                  {formatTarget(goal.targetDate)}
                </span>
              )}
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink/45">
                {goal.progress}%
              </span>
              <button
                onClick={() => remove(goal.id)}
                aria-label="Remove goal"
                className="font-mono text-ink/30 opacity-0 transition group-hover:opacity-100 hover:text-ink/60"
              >
                ×
              </button>
            </div>

            {goal.taskTotal > 0 ? (
              // Read-only: progress is computed from completed linked tasks.
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink/10"
                title={`${goal.progress}% — from completed daily tasks`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${goal.progress}%`,
                    backgroundColor: goal.done ? "#1D9E75" : "#D4A853",
                  }}
                />
              </div>
            ) : (
              <input
                type="range"
                min={0}
                max={100}
                value={goal.progress}
                onChange={(e) => progress(goal, Number(e.target.value))}
                className="goal-range mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full"
                style={{
                  background: `linear-gradient(to right, ${
                    goal.done ? "#1D9E75" : "#D4A853"
                  } ${goal.progress}%, rgba(28,28,30,0.1) ${goal.progress}%)`,
                }}
              />
            )}

            {/* Expanded detail */}
            {openPlan === goal.id && (
              <div className="mt-2 border-l border-gold/40 pl-3">
                {/* Weekly plan (chat goals with a plan) */}
                {goal.plan && goal.plan.length > 0 && (
                  <ul className="space-y-1">
                    {goal.plan.map((p) => (
                      <li
                        key={p.week}
                        className="font-sans text-xs leading-snug text-ink/65"
                      >
                        <span className="font-mono text-[10px] uppercase text-gold-deep">
                          W{p.week}
                        </span>{" "}
                        {p.focus}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Saved learning-plan document (day-by-day with resources) */}
                {planDocs[goal.id]?.length ? (
                  <ul className="space-y-2">
                    {planDocs[goal.id].map((d, i) => (
                      <li key={i} className="leading-snug">
                        <p className="font-sans text-xs text-ink/80">
                          <span className="font-mono text-[10px] text-gold-deep">
                            {d.date}
                          </span>{" "}
                          {d.topic}
                        </p>
                        {d.task && (
                          <p className="font-sans text-[11px] text-ink/55">
                            {d.task}
                          </p>
                        )}
                        {d.resources?.length ? (
                          <ul className="mt-0.5 space-y-1">
                            {d.resources.map((r, j) => (
                              <li
                                key={j}
                                className="selectable font-mono text-[10px] leading-snug text-ink/55"
                              >
                                {r.title} —{" "}
                                <button
                                  onClick={() => void openExternal(r.url)}
                                  className="break-all text-left text-gold-deep underline-offset-2 hover:underline"
                                  title="Open in browser"
                                >
                                  {r.url}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* Linked tasks but no document/weekly plan */}
                {!(goal.plan && goal.plan.length > 0) &&
                  !planDocs[goal.id]?.length &&
                  goal.taskTotal > 0 && (
                    <p className="font-sans text-[11px] italic text-ink/40">
                      {planDocs[goal.id] === undefined
                        ? "Loading…"
                        : "Daily tasks appear in Upcoming as their dates arrive."}
                    </p>
                  )}
              </div>
            )}
          </li>
        ))}
        {goals.length === 0 && (
          <li className="font-sans text-[13px] italic text-ink/35">
            No goals yet. Add one below, or ask the assistant.
          </li>
        )}
      </ul>

      <form onSubmit={add} className="no-drag mt-4 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a goal…"
          className="selectable flex-1 border-b border-ink/15 bg-transparent pb-1 font-sans text-sm text-ink transition placeholder:text-ink/30 focus:border-gold focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-ink/5 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wide text-gold-deep transition hover:bg-gold hover:text-cream"
        >
          Add
        </button>
      </form>
    </div>
  );
}
